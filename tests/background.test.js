import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import "../firefox/core.js";
import "../firefox/backup-transport.js";

const source = await fs.readFile(new URL("../firefox/background.js", import.meta.url), "utf8");
const P = globalThis.StreamFilterCore;
const mediaUrl = "https://video-weaver.test.ttvnw.net/media.m3u8";
const masterUrl = "https://usher.ttvnw.net/api/channel/hls/tester.m3u8?token=example";
const master = `#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60\n${mediaUrl}`;
const raw = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:100\n#EXT-X-TWITCH-LIVE-SEQUENCE:1000\n#EXT-X-CUE-OUT:2\n#EXTINF:2,ad\nad.ts\n#EXT-X-CUE-IN\n#EXTINF:2,live\ncontent.ts\n';

function event() { return { addListener(callback) { this.callback = callback; } }; }
function harness(saved = { backups: false }, engine = P) {
  const filters = new Map();
  const badges = [];
  const browser = {
    storage: { local: { async get() { return saved; }, async set(value) { Object.assign(saved, value); } } },
    runtime: { id: "test@local.invalid", getURL: path => `moz-extension://test/${path}`, getManifest: () => ({ version: "0.1.2" }), onMessage: event() },
    webRequest: { onBeforeRequest: event(), onHeadersReceived: event(), onErrorOccurred: event(), filterResponseData(id) {
      const filter = { writes: [], closed: false, disconnected: false,
        write(data) { this.writes.push(new Uint8Array(data)); },
        close() { this.closed = true; }, disconnect() { this.disconnected = true; } };
      filters.set(id, filter); return filter;
    } },
    browserAction: { async setBadgeText(value) { badges.push(value); }, async setBadgeBackgroundColor() {} },
    tabs: { async query() { return [{ id: 1 }]; }, async sendMessage() { return { ok: true }; }, onRemoved: event() }
  };
  vm.runInNewContext(source, { browser, StreamFilterCore: engine, PudblockCreatePageFetcher: globalThis.PudblockCreatePageFetcher, URL, Date, AbortController, TextDecoder, TextEncoder, Uint8Array, setTimeout, clearTimeout });
  let request = 0;
  const sender = { id: browser.runtime.id, url: "moz-extension://test/popup.html" };
  async function begin(url, extra = {}) {
    const details = { requestId: String(++request), tabId: 1, originUrl: "https://www.twitch.tv/tester", url, ...extra };
    await browser.webRequest.onBeforeRequest.callback(details);
    return { details, filter: filters.get(details.requestId) };
  }
  async function receive(url, data, extra) {
    const { filter, details } = await begin(url, extra);
    if (!filter) return null;
    const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
    // Split inside text rather than assuming StreamFilter events align to lines.
    for (const part of [bytes.slice(0, 17), bytes.slice(17, 43), bytes.slice(43)]) if (part.length) filter.ondata({ data: part.buffer });
    await filter.onstop();
    const output = Buffer.concat(filter.writes.map(value => Buffer.from(value)));
    return { filter, details, output, text: output.toString("utf8") };
  }
  return { browser, filters, badges, begin, receive, async map() { await receive(masterUrl, master); },
    message: message => browser.runtime.onMessage.callback(message, sender) };
}

test("master mapping preserves a playable ad window while activating the hidden-ad fallback", async () => {
  const h = harness();
  const result = await h.receive(masterUrl, master);
  assert.equal(result.text, master);
  assert.equal(result.filter.closed, true);
  const media = await h.receive(mediaUrl, raw);
  assert.match(media.text, /ad\.ts/);
  assert.match(media.text, /content\.ts/);
  assert.equal(media.filter.closed, true);
  const { status, diagnostics } = await h.message({ type: "status", tabId: 1 });
  assert.equal(status.result, "waiting");
  assert.equal(status.filtered, 1);
  assert.match(diagnostics.backupInfo, /switched off/);
});
test("Twitch v2 master requests map media playlists before any ad appears", async () => {
  const h = harness();
  const v2 = masterUrl.replace("/api/channel/", "/api/v2/channel/");
  const mapped = await h.receive(v2, master);
  assert.ok(mapped, "the v2 master response must be inspected");
  const clean = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:1\n#EXTINF:2,live\ncontent.ts\n';
  const media = await h.receive(mediaUrl, clean);
  assert.ok(media, "the mapped video playlist must be inspected");
  const { status, diagnostics } = await h.message({ type: "status", tabId: 1 });
  assert.equal(status.result, "clean");
  assert.equal(status.checked, 1);
  assert.equal(diagnostics.masters, 1);
  assert.equal(diagnostics.apiVersion, 2);
  assert.equal(diagnostics.variants, 1);
  assert.equal(diagnostics.requests, 2);
});

test("Firefox survives clean, ad-only and clean refreshes without returning an empty live playlist", async () => {
  const h = harness(); await h.map();
  const header = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:100\n#EXT-X-TWITCH-LIVE-SEQUENCE:1000\n';
  const clean = header + '#EXTINF:2,live\ncontent.ts\n';
  await h.receive(mediaUrl, clean);
  for (const sequence of [1001, 1002]) {
    const allAd = header.replace('LIVE-SEQUENCE:1000', `LIVE-SEQUENCE:${sequence}`) + '#EXT-X-CUE-OUT:2\n#EXTINF:2,Amazon|test\nad.ts\n';
    const response = await h.receive(mediaUrl, allAd);
    assert.ok(P.segmentCount(response.text) > 0, 'an ad-only refresh must not become an empty live playlist');
    assert.equal((await h.message({ type: 'status', tabId: 1 })).status.result, 'waiting');
  }
  const recovered = await h.receive(mediaUrl, clean.replace('LIVE-SEQUENCE:1000', 'LIVE-SEQUENCE:1003'));
  assert.match(recovered.text, /content\.ts/);
  assert.equal((await h.message({ type: 'status', tabId: 1 })).status.result, 'clean');
});

test("Firefox exposes the backup failure reason while keeping the hidden-ad fallback active", async () => {
  class Resolver {
    clear() {}
    async resolve(channel, variant, primary, signal, version, report) {
      report('For 1920x1080 @ 60 fps — popout: HTTP 403 requesting token; embed: backup also contains ads');
      return null;
    }
  }
  const h = harness({ backups: true }, { ...P, BackupResolver: Resolver }); await h.map();
  await h.receive(mediaUrl, raw);
  const { status, diagnostics } = await h.message({ type: 'status', tabId: 1 });
  assert.equal(status.result, 'waiting');
  assert.match(diagnostics.backupInfo, /403.*token.*embed.*ads/);
  assert.ok(diagnostics.backupAt > 0);
  assert.equal(diagnostics.issue, null);
});

test("Firefox page backup requests bypass their own response filter", async () => {
  const h = harness({ backups: true }); await h.map();
  let delegated = 0;
  const backupUrl = 'https://video-weaver.test.ttvnw.net/backup.m3u8';
  h.browser.tabs.sendMessage = async (tabId, message) => {
    if (message.type !== 'pudblock-backup-request') return { ok: true };
    delegated++;
    if (message.request.kind === 'token') return { status: 200, body: JSON.stringify({ data: { streamPlaybackAccessToken: { value: 'anonymous-token', signature: 'anonymous-signature' } } }) };
    const nested = await h.begin(message.request.url, { frameId: 0 });
    assert.equal(nested.filter, undefined, 'a page backup must not recursively attach another stream filter');
    if (message.request.url.includes('usher.ttvnw.net')) return { status: 200, body: master.replace(mediaUrl, backupUrl) };
    return { status: 200, body: '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:100\n#EXT-X-TWITCH-LIVE-SEQUENCE:1000\n#EXTINF:2,live\nclean.ts\n' };
  };
  const response = await h.receive(mediaUrl, raw);
  assert.match(response.text, /clean\.ts/);
  assert.doesNotMatch(response.text, /ad\.ts/);
  assert.equal(delegated, 3);
  const { status, diagnostics } = await h.message({ type: 'status', tabId: 1 });
  assert.equal(status.result, 'backup');
  assert.equal(diagnostics.masters, 1);
});

test("Firefox waits for the waiting-view acknowledgement before writing an ad-only preroll", async () => {
  const h = harness(); await h.map();
  let acknowledge;
  const ready = new Promise(resolve => { acknowledge = resolve; });
  h.browser.tabs.sendMessage = async () => { await ready; return { ok: true }; };
  const onlyAd = raw.slice(0, raw.indexOf('#EXT-X-CUE-IN'));
  const pending = h.receive(mediaUrl, onlyAd);
  await new Promise(resolve => setImmediate(resolve));
  const filter = [...h.filters.values()].at(-1);
  assert.equal(filter.writes.length, 0);
  acknowledge();
  assert.ok(P.segmentCount((await pending).text) > 0);
  assert.equal((await h.message({ type: 'status', tabId: 1 })).status.result, 'waiting');
});
test("unmapped video requests are visible in diagnostics without claiming a check", async () => {
  const h = harness();
  assert.equal((await h.begin(mediaUrl)).filter, undefined);
  const { status, diagnostics } = await h.message({ type: "status", tabId: 1 });
  assert.equal(status, null);
  assert.equal(diagnostics.requests, 1);
  assert.equal(diagnostics.masters, 0);
});
test("unmapped media, VODs and extension-initiated fetches are untouched", async () => {
  const h = harness();
  assert.equal((await h.begin(mediaUrl)).filter, undefined);
  assert.equal((await h.begin("https://usher.ttvnw.net/vod/123.m3u8")).filter, undefined);
  assert.equal((await h.begin(masterUrl, { tabId: -1 })).filter, undefined);
  assert.equal((await h.begin(masterUrl, { originUrl: "moz-extension://test/_generated_background_page.html" })).filter, undefined);
});
test("non-playlist error responses retain their exact bytes", async () => {
  const h = harness(); await h.map();
  const bytes = new Uint8Array([255, 0, 1, 128, 64]);
  const result = await h.receive(mediaUrl, bytes);
  assert.deepEqual([...result.output], [...bytes]);
  const { status, diagnostics } = await h.message({ type: "status", tabId: 1 });
  assert.equal(status.checked, 0);
  assert.match(diagnostics.issue, /not a playlist/);
});
test("filter failures are reported instead of appearing idle", async () => {
  const h = harness();
  const { filter } = await h.begin(masterUrl);
  filter.onerror();
  const { status, diagnostics } = await h.message({ type: "status", tabId: 1 });
  assert.equal(status.result, "error");
  assert.equal(status.checked, 0);
  assert.match(diagnostics.issue, /could not read/);
});
test("encrypted and byte-range playlists remain intact with an honest status", async () => {
  const h = harness(); await h.map();
  for (const tag of ['#EXT-X-KEY:METHOD=AES-128,URI="key"', "#EXT-X-BYTERANGE:100@0"]) {
    const data = raw.replace("#EXT-X-CUE-OUT:2", tag + "\n#EXT-X-CUE-OUT:2");
    assert.equal((await h.receive(mediaUrl, data)).text, data);
    assert.equal((await h.message({ type: "status", tabId: 1 })).status.result, "error");
  }
});
test("rewritten responses drop stale length and caching headers", async () => {
  const h = harness();
  const { details, filter } = await h.begin(masterUrl);
  const result = h.browser.webRequest.onHeadersReceived.callback({ ...details, responseHeaders: [
    { name: "Content-Length", value: "100" }, { name: "ETag", value: "old" },
    { name: "Content-Type", value: "application/vnd.apple.mpegurl" }
  ] });
  assert.equal(result.responseHeaders.some(item => item.name === "Content-Length"), false);
  assert.ok(result.responseHeaders.some(item => item.value === "no-store"));
  assert.ok(result.responseHeaders.some(item => item.name === "Content-Type"));
  filter.onstop();
});
test("oversized responses flush buffered data and disconnect", async () => {
  const h = harness();
  const { filter } = await h.begin(masterUrl);
  const data = new Uint8Array(1024 * 1024 + 1).fill(65);
  filter.ondata({ data: data.buffer });
  assert.equal(filter.disconnected, true);
  assert.equal(filter.writes[0].byteLength, data.length);
});
test("turning filtering off releases an outstanding response", async () => {
  const h = harness();
  const { filter } = await h.begin(masterUrl);
  const data = new TextEncoder().encode(master);
  filter.ondata({ data: data.buffer });
  const result = await h.message({ type: "settings", changes: { enabled: false }, tabId: 1 });
  assert.equal(result.settings.enabled, false);
  assert.equal(filter.disconnected, true);
  assert.equal(new TextDecoder().decode(filter.writes[0]), master);
  assert.equal((await h.begin(masterUrl)).filter, undefined);
});
test("changing settings aborts an in-flight backup before writing a response", async () => {
  let started;
  const waiting = new Promise(resolve => { started = resolve; });
  class SlowResolver {
    clear() {}
    async resolve(channel, variant, data, signal) {
      started();
      await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      return null;
    }
  }
  const h = harness({ backups: true }, { ...P, BackupResolver: SlowResolver });
  await h.map();
  const { filter } = await h.begin(mediaUrl);
  filter.ondata({ data: new TextEncoder().encode(raw).buffer });
  const stopped = filter.onstop();
  await waiting;
  await h.message({ type: "settings", changes: { enabled: false }, tabId: 1 });
  await stopped;
  assert.equal(filter.disconnected, true);
  assert.equal(filter.writes.length, 1);
  assert.equal(new TextDecoder().decode(filter.writes[0]), raw);
});
test("only extension pages can change settings", async () => {
  const h = harness();
  const result = await h.browser.runtime.onMessage.callback({ type: "settings", changes: { enabled: false } }, { id: "external", url: "https://example.com" });
  assert.equal(result, undefined);
  assert.equal((await h.message({ type: "status", tabId: 1 })).settings.enabled, true);
});
test("closing a tab removes its stream mappings", async () => {
  const h = harness(); await h.map();
  h.browser.tabs.onRemoved.callback(1);
  assert.equal((await h.begin(mediaUrl)).filter, undefined);
});
