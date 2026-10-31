import test from "node:test";
import assert from "node:assert/strict";
import "../firefox/core.js";
import "../firefox/backup-transport.js";

const P = globalThis.StreamFilterCore;
const create = globalThis.PudblockCreatePageFetcher;
test("Firefox delegates only a fixed anonymous token descriptor to the Twitch frame", async () => {
  const calls = [];
  const api = { tabs: { async sendMessage(...args) { calls.push(args); return { status: 200, body: '{"ok":true}' }; } } };
  const fetcher = create(api, 7, 3);
  const request = P.playbackTokenRequest("caedrel", "popout");
  const response = await fetcher(request.url, { ...request.init, credentials: "omit", signal: new AbortController().signal });
  assert.equal(response.ok, true);
  assert.equal(await response.text(), '{"ok":true}');
  assert.equal(calls[0][0], 7);
  assert.deepEqual(calls[0][2], { frameId: 3 });
  assert.deepEqual(calls[0][1].request, { kind: "token", channel: "caedrel", playerType: "popout" });
  assert.equal(calls[0][1].request.headers, undefined);
  assert.equal(calls[0][1].request.body, undefined);
});
test("Firefox rejects other endpoints, embedded credentials, non-HLS URLs and invalid player types", async () => {
  const api = { tabs: { sendMessage() { assert.fail("Invalid request reached the page"); } } };
  const fetcher = create(api, 1, 0);
  for (const url of ["https://example.com/list.m3u8", "https://ttvnw.net.evil.invalid/list.m3u8", "http://video.ttvnw.net/list.m3u8", "https://user:password@video.ttvnw.net/list.m3u8", "https://video.ttvnw.net/segment.ts"]) await assert.rejects(fetcher(url), error => error.reason === "page-transport");
  await assert.rejects(fetcher("https://gql.twitch.tv/gql", { method: "POST", body: JSON.stringify({ operationName: "OtherOperation", variables: {} }) }));
  assert.throws(() => P.playbackTokenRequest("tester", "other-player"));
});
test("Firefox keeps backup playlists marked for exclusion throughout the page request", async () => {
  const observed = [];
  let reply;
  const api = { tabs: { sendMessage() { return new Promise(resolve => { reply = resolve; }); } } };
  const fetcher = create(api, 1, 0, { start: url => observed.push(["start", url]), end: url => observed.push(["end", url]) });
  const url = "https://video.ttvnw.net/backup.m3u8";
  const pending = fetcher(url);
  assert.deepEqual(observed, [["start", url]]);
  reply({ status: 200, body: "#EXTM3U\n#EXTINF:2,live\ncontent.ts" });
  assert.equal((await pending).ok, true);
  assert.deepEqual(observed, [["start", url], ["end", url]]);
});
test("Firefox cancellation reaches the page and releases the caller without waiting for a late response", async () => {
  const messages = [];
  const api = { tabs: { sendMessage(tab, message) { messages.push(message); return message.type.endsWith("cancel") ? Promise.resolve({ ok: true }) : new Promise(() => {}); } } };
  const controller = new AbortController();
  const pending = create(api, 1, 0)("https://video.ttvnw.net/list.m3u8", { signal: controller.signal });
  controller.abort("backup-timeout");
  await assert.rejects(pending, error => error.name === "AbortError");
  assert.equal(messages.length, 2);
  assert.equal(messages[1].type, "pudblock-backup-cancel");
  assert.equal(messages[0].id, messages[1].id);
});
test("Firefox reports a missing helper and validates untrusted page responses", async () => {
  await assert.rejects(create({ tabs: { async sendMessage() { throw new Error("No listener"); } } }, 1, 0)("https://video.ttvnw.net/list.m3u8"), error => error.reason === "page-transport");
  for (const response of [{ status: 200, body: "x".repeat(1024 * 1024 + 1) }, { status: 999, body: "" }, { status: 200, body: {} }]) {
    await assert.rejects(create({ tabs: { async sendMessage() { return response; } } }, 1, 0)("https://video.ttvnw.net/list.m3u8"), error => error.reason === "page-response");
  }
});
