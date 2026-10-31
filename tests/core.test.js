import test from "node:test";
import assert from "node:assert/strict";
import "../firefox/core.js";

const P = globalThis.StreamFilterCore;
const header = "#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:100\n#EXT-X-TWITCH-LIVE-SEQUENCE:1000\n";
const segment = name => `#EXTINF:2.000,live\n${name}.ts\n`;
const pod = '#EXT-X-DATERANGE:ID="ad",CLASS="twitch-stitched-ad",DURATION=4.0\n#EXT-X-DISCONTINUITY\n' + segment("ad-1") + segment("ad-2") + "#EXT-X-DISCONTINUITY\n";

test("clean playlists pass through verbatim", () => {
  const text = header + segment("content");
  assert.equal(P.stripAds(text).content, text);
  assert.equal(P.containsAds(text), false);
});
test("a stitched pod is removed with sequence identity repaired", () => {
  const result = P.stripAds(header + segment("before") + pod + segment("after"));
  assert.equal(result.removed, 2);
  assert.doesNotMatch(result.content, /ad-[12]|stitched|before\.ts/);
  assert.match(result.content, /after\.ts/);
  assert.match(result.content, /#EXT-X-MEDIA-SEQUENCE:103\n/);
  assert.match(result.content, /#EXT-X-TWITCH-LIVE-SEQUENCE:1003\n/);
  assert.match(result.content, /#EXT-X-DISCONTINUITY-SEQUENCE:2\n/);
  assert.equal((result.content.match(/#EXTINF:/g) || []).length, P.segmentCount(result.content));
});
test("PLANNED-DURATION does not replace the actual pod duration", () => {
  const text = (header + pod + segment("after")).replace("DURATION=4.0", "PLANNED-DURATION=300,DURATION=4.0");
  assert.match(P.stripAds(text).content, /after\.ts/);
});
test("internal creative discontinuities do not close the pod early", () => {
  const text = header + pod.replace(segment("ad-2"), "#EXT-X-DISCONTINUITY\n" + segment("ad-2")) + segment("after");
  const result = P.stripAds(text);
  assert.equal(result.removed, 2);
  assert.doesNotMatch(result.content, /ad-2\.ts/);
  assert.match(result.content, /after\.ts/);
});
test("SCTE cue brackets work without a stitched marker", () => {
  const result = P.stripAds(header + "#EXT-X-CUE-OUT:4\n" + segment("ad-1") + segment("ad-2") + "#EXT-X-CUE-IN\n" + segment("after"));
  assert.equal(result.removed, 2);
  assert.doesNotMatch(result.content, /CUE|ad-\d/);
  assert.match(result.content, /after\.ts/);
});
test("all-ad prerolls keep the HLS headers and remove prefetch hints", () => {
  const text = header + pod.split("#EXT-X-DISCONTINUITY\n").slice(0, 2).join("#EXT-X-DISCONTINUITY\n") + "#EXT-X-TWITCH-PREFETCH:ad-future.ts\n";
  const result = P.stripAds(text);
  assert.equal(result.removed, 2);
  assert.equal(P.segmentCount(result.content), 0);
  assert.ok(result.content.startsWith("#EXTM3U\n"));
  assert.match(result.content, /#EXT-X-TARGETDURATION:2/);
  assert.doesNotMatch(result.content, /PREFETCH/);
});
test("a leading ad tail and a later marked pod are both removed", () => {
  const text = header + segment("tail") + "#EXT-X-DISCONTINUITY\n" + segment("middle") + pod + segment("after");
  const result = P.stripAds(text);
  assert.equal(result.removed, 3);
  assert.doesNotMatch(result.content, /tail\.ts|ad-\d/);
  assert.match(result.content, /after\.ts/);
});
test("Amazon segment labels detect a tail without any remaining opener", () => {
  const text = header + "#EXTINF:2,Amazon|test\nad.ts\n#EXT-X-DISCONTINUITY\n" + segment("after");
  assert.equal(P.containsAds(text), true);
  const result = P.stripAds(text);
  assert.equal(result.removed, 1);
  assert.match(result.content, /after\.ts/);
});
test("map state survives trimming before the first retained segment", () => {
  const result = P.stripAds(header + '#EXT-X-MAP:URI="init.mp4"\n' + pod + segment("after"));
  assert.match(result.content, /#EXT-X-MAP:URI="init.mp4"/);
});
test("absolute backup URIs include segments, keys and init maps", () => {
  const result = P.absolutize('#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-MAP:URI="/init"\n#EXTINF:2,live\nsegment.ts', "https://video-weaver.test.ttvnw.net/path/list.m3u8");
  assert.match(result, /URI="https:\/\/video-weaver.test.ttvnw.net\/path\/key"/);
  assert.match(result, /URI="https:\/\/video-weaver.test.ttvnw.net\/init"/);
  assert.match(result, /https:\/\/video-weaver.test.ttvnw.net\/path\/segment.ts/);
  assert.throws(() => P.absolutize("#EXTM3U\nfile:///etc/passwd", "https://example.com/list.m3u8"));
});
test("variant parsing handles quoted commas and rejects quality or codec changes", () => {
  const text = '#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1234,RESOLUTION=1920x1080,FRAME-RATE=60.000,CODECS="avc1.64002A,mp4a.40.2"\n1080.m3u8\n#EXT-X-STREAM-INF:BANDWIDTH=500,RESOLUTION=1280x720,FRAME-RATE=30\n720.m3u8';
  const variants = P.parseVariants(text, "https://test.ttvnw.net/path/master.m3u8");
  assert.equal(variants[0].codecs, "avc1.64002A,mp4a.40.2");
  assert.equal(P.selectVariant(variants, variants[0]).url, "https://test.ttvnw.net/path/1080.m3u8");
  assert.equal(P.selectVariant(variants, { ...variants[0], frameRate: 30 }), undefined);
  assert.equal(P.selectVariant(variants, { ...variants[0], codecs: "hvc1" }), undefined);
});
test("timeline switching uses a broadcast sequence and trims stale prefixes", () => {
  const timeline = new P.Timeline();
  const clean = header + segment("a") + segment("b") + segment("c");
  assert.match(timeline.normalize("variant", clean), /#EXT-X-MEDIA-SEQUENCE:1000\n/);
  const backup = clean.replace("LIVE-SEQUENCE:1000", "LIVE-SEQUENCE:999").replace("MEDIA-SEQUENCE:100", "MEDIA-SEQUENCE:0");
  const result = timeline.normalize("variant", backup);
  assert.match(result, /#EXT-X-MEDIA-SEQUENCE:1000\n/);
  assert.doesNotMatch(result, /a\.ts/);
  assert.match(result, /b\.ts/);
  assert.match(timeline.normalize("other-variant", backup), /#EXT-X-MEDIA-SEQUENCE:999\n/);
});
test("post-ad sequence repairs survive normalization", () => {
  const filtered = P.stripAds(header + pod + segment("after"));
  assert.match(new P.Timeline().normalize("variant", filtered.content), /#EXT-X-MEDIA-SEQUENCE:1002\n/);
});

test("a completely stale backup is rejected without emptying or advancing the playback window", () => {
  const timeline = new P.Timeline();
  const current = timeline.normalize('stream', header + segment('current'));
  const stale = header.replace('LIVE-SEQUENCE:1000', 'LIVE-SEQUENCE:900') + segment('stale');
  assert.equal(timeline.normalize('stream', stale, { candidate: true }), null);
  assert.equal(timeline.normalize('stream', stale), current);
  assert.match(timeline.normalize('stream', header.replace('LIVE-SEQUENCE:1000', 'LIVE-SEQUENCE:1001') + segment('next')), /next\.ts/);
});
test("a missing broadcast anchor or encryption disallows backup substitution", () => {
  assert.equal(P.compatibleTimeline(header, header), true);
  assert.equal(P.compatibleTimeline(header, "#EXTM3U\n#EXT-X-MEDIA-SEQUENCE:0"), false);
  assert.equal(P.compatibleTimeline(header, header + '#EXT-X-KEY:METHOD=AES-128,URI="key"'), false);
});
test("CDN checks enforce the hostname boundary and HTTPS", () => {
  assert.equal(P.isTwitchStreamUrl("https://video-weaver.test.ttvnw.net/a.m3u8"), true);
  assert.equal(P.isTwitchStreamUrl("https://ttvnw.net.evil.invalid/a.m3u8"), false);
  assert.equal(P.isTwitchStreamUrl("http://video.ttvnw.net/a.m3u8"), false);
});
test("backup resolver caches masters, checks playlists and keeps tokens anonymous", async () => {
  const calls = [];
  const variantUrl = "https://video-weaver.test.ttvnw.net/clean.m3u8";
  const target = { resolution: "1920x1080", frameRate: 60, codecs: "avc1" };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    if (url.includes("gql.twitch.tv")) return new Response(JSON.stringify({ data: { streamPlaybackAccessToken: { signature: "sig", value: '{"example":"value"}' } } }));
    if (url.includes("usher.ttvnw.net")) return new Response(`#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60,CODECS="avc1"\n${variantUrl}`);
    return new Response(header + segment("content"));
  };
  const resolver = new P.BackupResolver(fetcher);
  const signal = new AbortController().signal;
  const result = await resolver.resolve("tester", target, header + pod, signal);
  assert.equal(result.playerType, "popout");
  assert.match(result.content, /https:\/\/video-weaver.test.ttvnw.net\/content.ts/);
  await resolver.resolve("tester", target, header + pod, signal);
  assert.equal(calls.filter(call => call.url.includes("gql.twitch.tv")).length, 1);
  assert.ok(calls.every(call => call.init.credentials === "omit"));
  assert.ok(calls.every(call => !call.init.headers?.Authorization));
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.variables.playerType, "popout");
  assert.equal(body.variables.isVod, false);
  assert.equal(body.variables.vodID, "");
});
test("HTTP errors and JSON error bodies never count as clean backups", async () => {
  let tokenCalls = 0;
  const fetcher = async url => {
    if (url.includes("gql.twitch.tv")) { tokenCalls++; return new Response(JSON.stringify({ data: { streamPlaybackAccessToken: { signature: "s", value: "t" } } })); }
    if (url.includes("usher.ttvnw.net")) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60\nhttps://test.ttvnw.net/media.m3u8');
    return new Response('{"error":"expired"}', { status: 403 });
  };
  const resolver = new P.BackupResolver(fetcher);
  assert.equal(await resolver.resolve("tester", { resolution: "1920x1080", frameRate: 60 }, header, new AbortController().signal), null);
  assert.equal(tokenCalls, 2);
});
test("failed master fetches back off instead of minting on every refresh", async () => {
  let calls = 0;
  let now = 1000;
  const resolver = new P.BackupResolver(async () => { calls++; return new Response("error", { status: 503 }); }, () => now);
  const signal = new AbortController().signal;
  await resolver.master("tester", "embed", signal);
  await resolver.master("tester", "embed", signal);
  assert.equal(calls, 1);
  now += 15001;
  await resolver.master("tester", "embed", signal);
  assert.equal(calls, 2);
});

test("a cancelled backup request does not suppress the next fresh search for 15 seconds", async () => {
  let tokenCalls = 0;
  const resolver = new P.BackupResolver(async (url, init) => {
    if (url.includes('gql.twitch.tv')) {
      tokenCalls++;
      if (tokenCalls === 1) {
        await new Promise(resolve => init.signal.addEventListener('abort', resolve, { once: true }));
        throw new DOMException('Aborted', 'AbortError');
      }
      return new Response(JSON.stringify({ data: { streamPlaybackAccessToken: { signature: 'sig', value: 'private-token' } } }));
    }
    return new Response('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60\nhttps://test.ttvnw.net/media.m3u8');
  });
  const first = new AbortController();
  const pending = resolver.master('tester', 'popout', first.signal);
  first.abort('backup-timeout');
  assert.equal(await pending, null);
  const result = await resolver.master('tester', 'popout', new AbortController().signal);
  assert.ok(result?.length, 'a fresh caller must retry immediately after cancellation');
  assert.equal(tokenCalls, 2);
});

test("backup diagnostics distinguish rejected tokens and a clean second backup without exposing URLs or tokens", async () => {
  let playerType;
  const resolver = new P.BackupResolver(async (url, init) => {
    if (url.includes('gql.twitch.tv')) {
      playerType = JSON.parse(init.body).variables.playerType;
      if (playerType === 'popout') return new Response('Denied', { status: 403 });
      return new Response(JSON.stringify({ data: { streamPlaybackAccessToken: { signature: 'private-signature', value: 'private-token' } } }));
    }
    if (url.includes('usher.ttvnw.net')) return new Response('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60\nhttps://test.ttvnw.net/media.m3u8');
    return new Response(header + segment('content'));
  });
  let diagnostic;
  const result = await resolver.resolve('tester', { resolution: '1920x1080', frameRate: 60 }, header, new AbortController().signal, 2, info => { diagnostic = info; });
  assert.equal(result.playerType, 'embed');
  assert.match(diagnostic, /popout.*403.*token/i);
  assert.match(diagnostic, /embed.*clean/i);
  assert.doesNotMatch(diagnostic, /https?:|private-token|private-signature|media\.m3u8/);
});
test("backup requests preserve the primary Twitch API version and separate its cache", async () => {
  const urls = [];
  const resolver = new P.BackupResolver(async url => {
    urls.push(url);
    if (url.includes("gql.twitch.tv")) return new Response(JSON.stringify({ data: { streamPlaybackAccessToken: { signature: "sig", value: "token" } } }));
    return new Response('#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60\nhttps://test.ttvnw.net/media.m3u8');
  });
  const signal = new AbortController().signal;
  await resolver.master("tester", "popout", signal, 2);
  await resolver.master("tester", "popout", signal, 1);
  const masters = urls.filter(url => url.includes("usher.ttvnw.net"));
  assert.equal(masters.length, 2);
  assert.equal(new URL(masters[0]).pathname, "/api/v2/channel/hls/tester.m3u8");
  assert.equal(new URL(masters[1]).pathname, "/api/channel/hls/tester.m3u8");
});
