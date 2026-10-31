import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import "../firefox/core.js";

const runtimeSource = await fs.readFile(new URL("../chrome/stream-runtime.js", import.meta.url), "utf8");
const P = globalThis.StreamFilterCore;
const masterUrl = "https://usher.ttvnw.net/api/v2/channel/hls/tester.m3u8?token=original";
const mediaUrl = "https://video-weaver.test.ttvnw.net/media.m3u8";
const master = `#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60\n${mediaUrl}`;
const header = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-TWITCH-LIVE-SEQUENCE:100\n";
const ad = header + '#EXT-X-CUE-OUT:2\n#EXTINF:2,ad\nad.ts\n#EXT-X-CUE-IN\n#EXTINF:2,live\ncontent.ts\n';
function harness({ media = ad, engine = P, backups = false, delay, publish } = {}) {
  const events = [];
  const shared = [];
  const requests = [];
  const scope = { StreamFilterCore: engine, location: { href: "https://www.twitch.tv/tester" }, async fetch(input, init) {
    requests.push({ input, init });
    const url = typeof input === "string" ? input : input.url;
    if (delay) await delay(url);
    const response = new Response(url === masterUrl ? master : typeof media === "function" ? media(url) : media, { headers: { "Content-Length": "123", "Content-Type": "application/vnd.apple.mpegurl" } });
    Object.defineProperty(response, "url", { value: url });
    return response;
  } };
  const context = { globalThis: {}, URL, Headers, Response, TextDecoder, DOMException, AbortController, setTimeout, clearTimeout };
  vm.runInNewContext(runtimeSource, context);
  const runtime = context.globalThis.PudblockInstallRuntime(scope, { enabled: true, backups, initialized: true }, entries => shared.push(...entries), event => { events.push(event); return publish?.(event); });
  return { scope, runtime, events, shared, requests, async map() { await scope.fetch(masterUrl); } };
}
test("Chrome checks clean playlists before any ad appears", async () => {
  const h = harness({ media: header + "#EXTINF:2,live\ncontent.ts\n" });
  await h.map();
  const response = await h.scope.fetch(mediaUrl);
  assert.match(await response.text(), /MEDIA-SEQUENCE:100/);
  assert.equal(h.events.at(-1).result, "clean");
  assert.equal(h.events[0].apiVersion, 2);
});
test("Chrome preserves the playable ad window and acknowledges the hidden-ad fallback", async () => {
  const h = harness(); await h.map();
  const response = await h.scope.fetch(mediaUrl);
  const result = await response.text();
  assert.match(result, /ad\.ts|CUE-/);
  assert.match(result, /content\.ts/);
  assert.match(result, /MEDIA-SEQUENCE:100/);
  assert.equal(h.events.at(-1).result, "waiting");
  assert.equal(response.url, mediaUrl);
  assert.equal(response.headers.has("content-length"), false);
});

test("Chrome survives clean, ad-only and clean refreshes without returning an empty live playlist", async () => {
  let media = header + '#EXTINF:2,live\ncontent.ts\n';
  const h = harness({ media: () => media }); await h.map();
  await h.scope.fetch(mediaUrl);
  for (const sequence of [101, 102]) {
    media = header.replace('LIVE-SEQUENCE:100', `LIVE-SEQUENCE:${sequence}`) + '#EXT-X-CUE-OUT:2\n#EXTINF:2,Amazon|test\nad.ts\n';
    const text = await (await h.scope.fetch(mediaUrl)).text();
    assert.ok(P.segmentCount(text) > 0, 'an ad-only refresh must not become an empty live playlist');
    assert.equal(h.events.at(-1).result, 'waiting');
  }
  media = header.replace('LIVE-SEQUENCE:100', 'LIVE-SEQUENCE:103') + '#EXTINF:2,live\ncontent.ts\n';
  assert.match(await (await h.scope.fetch(mediaUrl)).text(), /content\.ts/);
  assert.equal(h.events.at(-1).result, 'clean');
});

test("Chrome waits for the waiting-view acknowledgement before giving an ad-only preroll to the player", async () => {
  let acknowledge;
  const ready = new Promise(resolve => { acknowledge = resolve; });
  const onlyAd = header + '#EXT-X-CUE-OUT:2\n#EXTINF:2,Amazon|test\nad.ts\n';
  const h = harness({ media: onlyAd, publish: event => event.result === 'waiting' ? ready : undefined }); await h.map();
  let delivered = false;
  const pending = h.scope.fetch(mediaUrl).then(response => { delivered = true; return response; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(delivered, false);
  acknowledge();
  assert.ok(P.segmentCount(await (await pending).text()) > 0);
  assert.equal(h.events.at(-1).result, 'waiting');
});
test("Chrome leaves unmapped media, VODs and non-playlist fetches untouched", async () => {
  const h = harness();
  assert.equal(await (await h.scope.fetch(mediaUrl)).text(), ad);
  assert.equal(await (await h.scope.fetch("https://usher.ttvnw.net/vod/123.m3u8")).text(), ad);
  assert.equal(h.events.length, 0);
});
test("Chrome shares master mappings between page and worker realms", async () => {
  const page = harness(); const worker = harness();
  await page.map();
  worker.runtime.learnContexts(page.shared);
  assert.match(await (await worker.scope.fetch(mediaUrl)).text(), /MEDIA-SEQUENCE:100/);
  assert.equal(worker.events.at(-1).result, "waiting");
});
test("Chrome on/off changes take effect without discarding known channel mappings", async () => {
  const h = harness(); await h.map();
  h.runtime.updateSettings({ enabled: false, backups: false });
  assert.equal(await (await h.scope.fetch(mediaUrl)).text(), ad);
  h.runtime.updateSettings({ enabled: true, backups: false });
  assert.match(await (await h.scope.fetch(mediaUrl)).text(), /ad\.ts/);
  assert.equal(h.events.at(-1).result, "waiting");
});
test("Chrome preserves original request objects and init options", async () => {
  const h = harness(); await h.map();
  const request = new Request(mediaUrl);
  const init = { cache: "no-store", credentials: "include" };
  await h.scope.fetch(request, init);
  assert.equal(h.requests.at(-1).input, request);
  assert.equal(h.requests.at(-1).init, init);
});
test("Chrome unsupported formats retain the original playlist and explain why", async () => {
  const media = ad.replace("#EXT-X-CUE-OUT:2", '#EXT-X-KEY:METHOD=AES-128,URI="key"\n#EXT-X-CUE-OUT:2');
  const h = harness({ media }); await h.map();
  assert.equal(await (await h.scope.fetch(mediaUrl)).text(), media);
  assert.equal(h.events.at(-1).kind, "issue");
});
test("Chrome returns a clean backup when available", async () => {
  class Resolver { clear() {} async resolve() { return { content: header + "#EXTINF:2,live\nhttps://test.ttvnw.net/backup.ts\n" }; } }
  const h = harness({ engine: { ...P, BackupResolver: Resolver }, backups: true }); await h.map();
  assert.match(await (await h.scope.fetch(mediaUrl)).text(), /backup\.ts/);
  assert.equal(h.events.at(-1).result, "backup");
});

test("Chrome forwards backup failure diagnostics independently of its waiting-view result", async () => {
  class Resolver {
    clear() {}
    async resolve(channel, variant, primary, signal, version, report) {
      report('For 1920x1080 @ 60 fps — popout: timed out requesting token; embed: search deadline reached before attempt');
      return null;
    }
  }
  const h = harness({ engine: { ...P, BackupResolver: Resolver }, backups: true }); await h.map();
  await h.scope.fetch(mediaUrl);
  assert.equal(h.events.at(-1).result, 'waiting');
  assert.match(h.events.find(event => event.kind === 'backup-info').info, /timed out.*embed.*deadline/);
});
test("Chrome disabling filtering aborts a pending backup and keeps original playback", async () => {
  let started;
  const pending = new Promise(resolve => { started = resolve; });
  class Resolver { clear() {} async resolve(channel, variant, raw, signal) { started(); await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true })); return null; } }
  const h = harness({ engine: { ...P, BackupResolver: Resolver }, backups: true }); await h.map();
  const response = h.scope.fetch(mediaUrl);
  await pending;
  h.runtime.updateSettings({ enabled: false, backups: true });
  assert.equal(await (await response).text(), ad);
  assert.equal(h.events.some(event => event.kind === "result"), false);
});
