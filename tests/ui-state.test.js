import test from "node:test";
import assert from "node:assert/strict";
import "../firefox/ui-state.js";

const describe = globalThis.StreamFilterUI.describe;
const settings = { enabled: true, backups: true };
test("no observed requests never claims that stream checking is active", () => {
  const state = describe({ settings, status: null, diagnostics: null });
  assert.equal(state.label, "No stream requests detected");
  assert.match(state.detail, /even without ads/);
});
test("an unlinked video request is distinguishable from no requests", () => {
  const state = describe({ settings, diagnostics: { requests: 10, masters: 0 } });
  assert.equal(state.label, "Video requests are not linked");
});
test("master detection is distinguishable from confirmed media checks", () => {
  const state = describe({ settings, diagnostics: { requests: 1, masters: 1, variants: 8, channel: "xqc" } });
  assert.equal(state.label, "Stream detected");
  assert.match(state.detail, /first video playlist/);
  assert.notEqual(state.tone, "active");
});
test("a clean playlist confirms activity without requiring an ad", () => {
  const state = describe({ settings, status: { channel: "xqc", result: "clean", checked: 2, lastSeen: 1000 } }, 1500);
  assert.equal(state.label, "Checking live stream");
  assert.equal(state.tone, "active");
  assert.match(state.detail, /No ad markers/);
});
test("old successful checks are shown as inactive rather than ready", () => {
  const state = describe({ settings, status: { channel: "xqc", result: "clean", checked: 2, lastSeen: 1000 } }, 22000);
  assert.equal(state.label, "No recent playlist activity");
});
test("processing failures explain the problem even before the first successful check", () => {
  const state = describe({ settings, diagnostics: { issue: "Firefox could not read a playlist response." } });
  assert.equal(state.label, "Filtering unavailable");
  assert.match(state.detail, /could not read/);
});
test("disabled filtering takes precedence over diagnostics", () => {
  const state = describe({ settings: { enabled: false }, diagnostics: { issue: "Old error" } });
  assert.equal(state.label, "Filtering is off");
});
