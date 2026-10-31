import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
const source = await fs.readFile(new URL("../chrome/background.js", import.meta.url), "utf8");
function event() { return { addListener(callback) { this.callback = callback; } }; }
function harness(local = {}, session = {}) {
  const api = {
    storage: {
      local: { async get() { return structuredClone(local); }, async set(value) { Object.assign(local, structuredClone(value)); } },
      session: { async get() { return structuredClone(session); }, async set(value) { Object.assign(session, structuredClone(value)); } }
    },
    runtime: { id: "unit-id", getURL: value => "chrome-extension://unit-id/" + value, getManifest: () => ({ version: "0.2.0" }), onMessage: event() },
    tabs: { async query() { return [{ id: 1 }]; }, async sendMessage() {}, onRemoved: event(), onUpdated: event() },
    action: { async setBadgeText() {}, async setBadgeBackgroundColor() {} },
    webRequest: { onBeforeRequest: event() }
  };
  vm.runInNewContext(source, { chrome: api, URL });
  const popup = { id: "unit-id", url: "chrome-extension://unit-id/popup.html" };
  const page = { id: "unit-id", url: "https://www.twitch.tv/tester", tab: { id: 1 } };
  const message = (value, sender = popup) => new Promise(resolve => api.runtime.onMessage.callback(value, sender, resolve));
  return { api, message, page, session, local };
}
test("Chrome permits Twitch telemetry and configuration but reserves settings for extension pages", async () => {
  const h = harness();
  assert.equal((await h.message({ type: "configure" }, h.page)).settings.enabled, true);
  assert.equal(await h.message({ type: "settings", changes: { enabled: false } }, h.page), undefined);
  assert.equal((await h.message({ type: "status", tabId: 1 })).settings.enabled, true);
  assert.equal((await h.message({ type: "settings", changes: { enabled: false }, tabId: 1 })).settings.enabled, false);
});
test("Chrome rejects telemetry from other extensions or unrelated websites", async () => {
  const h = harness();
  for (const sender of [{ ...h.page, id: "different" }, { ...h.page, url: "https://twitch.tv.evil.invalid/" }, { ...h.page, url: "http://www.twitch.tv/" }]) {
    assert.equal(await h.message({ type: "stream-events", events: [{ kind: "result", result: "clean", channel: "tester" }] }, sender), undefined);
  }
  assert.equal((await h.message({ type: "status", tabId: 1 })).status, null);
});

test("Chrome bounds local backup diagnostics, persists them and clears them on a channel change", async () => {
  const h = harness();
  await h.message({ type: 'stream-events', events: [{ kind: 'backup-info', channel: 'tester', info: 'x'.repeat(1000) }] }, h.page);
  const state = await h.message({ type: 'status', tabId: 1 });
  assert.equal(state.diagnostics.backupInfo.length, 700);
  assert.ok(state.diagnostics.backupAt > 0);
  const restarted = harness(h.local, h.session);
  assert.equal((await restarted.message({ type: 'status', tabId: 1 })).diagnostics.backupInfo.length, 700);
  await restarted.message({ type: 'stream-events', events: [{ kind: 'master', channel: 'different', variants: 2, apiVersion: 2 }] }, h.page);
  assert.equal((await restarted.message({ type: 'status', tabId: 1 })).diagnostics.backupInfo, null);
});
test("Chrome recognizes worker master responses without a network tab association", async () => {
  const h = harness();
  await h.message({ type: "stream-events", events: [{ kind: "master", channel: "tester", variants: 5, apiVersion: 2 }] }, h.page);
  const state = await h.message({ type: "status", tabId: 1 });
  assert.equal(state.diagnostics.masters, 1);
  assert.equal(state.diagnostics.variants, 5);
});
test("Chrome network and adapter observations do not double-count a master", async () => {
  const h = harness();
  h.api.webRequest.onBeforeRequest.callback({ tabId: 1, url: "https://usher.ttvnw.net/api/v2/channel/hls/tester.m3u8" });
  await h.message({ type: "stream-events", events: [{ kind: "master", channel: "tester", variants: 5, apiVersion: 2 }] }, h.page);
  assert.equal((await h.message({ type: "status", tabId: 1 })).diagnostics.masters, 1);
});
test("Chrome status and settings survive a service-worker restart", async () => {
  const local = { backups: false };
  const session = {};
  const first = harness(local, session);
  await first.message({ type: "stream-events", events: [
    { kind: "master", channel: "tester", variants: 5, apiVersion: 2 },
    { kind: "result", channel: "tester", result: "filtered" }
  ] }, first.page);
  const restarted = harness(local, session);
  const state = await restarted.message({ type: "status", tabId: 1 });
  assert.equal(state.settings.backups, false);
  assert.equal(state.status.checked, 1);
  assert.equal(state.status.filtered, 1);
  assert.equal(state.diagnostics.variants, 5);
});
test("Chrome tab removal drops counters from session storage", async () => {
  const h = harness();
  await h.message({ type: "stream-events", events: [{ kind: "result", channel: "tester", result: "clean" }] }, h.page);
  h.api.tabs.onRemoved.callback(1);
  assert.equal((await h.message({ type: "status", tabId: 1 })).status, null);
  assert.deepEqual(h.session.tabStates, {});
});
