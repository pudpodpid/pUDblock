// Live detection check in a fresh Chrome profile; no account or user profile is
// used. Diagnostics contain counters and generic errors, never signed URLs.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { root, launchChrome } from "./chrome-test-utils.mjs";

const channel = process.argv[2] || "xqc";
if (!/^[a-z0-9_]{1,40}$/i.test(channel)) throw new Error("Provide a Twitch channel login");
await fs.mkdir(path.join(root, ".test-artifacts"), { recursive: true });
const output = await fs.mkdtemp(path.join(root, ".test-artifacts", "chrome-live-"));
const baseline = process.env.PUDBLOCK_BASELINE === "1";
const { browser, extensionId } = await launchChrome(undefined, {loadExtension:!baseline});
try {
  const ui = await browser.newPage();
  if (!baseline) await ui.goto(`chrome-extension://${extensionId}/popup.html`);
  const page = await browser.newPage();
  await page.bringToFront();
  const errors = [];
  page.on("pageerror", error => errors.push(error.message.replace(/https?:\/\/[^\s'"<>]+/g, "[URL]").slice(0, 200)));
  await page.goto(`https://www.twitch.tv/${channel}`, { waitUntil: "domcontentloaded", timeout: 30000 });
  const tabId = baseline ? null : await ui.evaluate(async channel => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(`https://www.twitch.tv/${channel}`)).id, channel);
  let state;
  let triedPlay = false;
  let contentWarningAcknowledged = false;
  const until = Date.now() + 30000;
  while (Date.now() < until) {
    if (!contentWarningAcknowledged) {
      const gate = await page.evaluateHandle(() => [...document.querySelectorAll('button')].find(node => node.textContent.trim() === 'Start Watching'));
      const button = gate.asElement();
      if (button) { await button.click(); contentWarningAcknowledged = true; }
      await gate.dispose();
    }
    if (!baseline) state = await ui.evaluate(tabId => chrome.runtime.sendMessage({ type: "status", tabId }), tabId);
    const playing = await page.evaluate(() => [...document.querySelectorAll('video')].some(item => !item.paused && item.readyState >= 2 && item.currentTime > 1));
    if (playing && (baseline || state.status?.checked >= 8)) break;
    if (!triedPlay && Date.now() > until - 24000) {
      const play = await page.$('[data-a-target="player-play-pause-button"]');
      if (play && !playing && /^play\b/i.test(await play.evaluate(node => node.getAttribute('aria-label') || ''))) { triedPlay = true; await play.click(); }
    }
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  const playback = await page.evaluate(() => ({ visibility: document.visibilityState, overlay: document.querySelector('[data-a-target="player-overlay-content"]')?.textContent?.slice(0,300) || "", video: [...document.querySelectorAll("video")].map(item => ({ readyState: item.readyState, paused: item.paused, currentTime: Math.round(item.currentTime * 100) / 100, width: item.videoWidth, error: item.error?.code || null })) }));
  const report = { baseline, contentWarningAcknowledged, state, ...playback, errors };
  await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
  await page.screenshot({path:path.join(output,'stream.png')});
  if (!baseline) {
    await page.bringToFront();
    await ui.reload();
    await new Promise(resolve => setTimeout(resolve, 500));
    await ui.screenshot({ path: path.join(output, "popup.png"), clip: { x: 0, y: 0, width: 338, height: Math.min(800, await ui.$eval("body", node => node.scrollHeight)) } });
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`Sanitized live check: ${path.join(output, "report.json")}`);
  if (!baseline) {
    assert.ok(state.status?.checked > 0, "No live playlists were checked; the channel may be offline or playback unavailable");
    assert.equal(state.diagnostics?.issue, null, "Chrome reported a filtering issue");
  }
  assert.ok(playback.video.some(item => item.readyState >= 2 && !item.paused && item.currentTime > 0), "The Twitch player did not start playing in the live check");
} finally { await browser.close(); }
