import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { root, launchChrome } from "./chrome-test-utils.mjs";
import { installPlayerFixture } from "./player-guard-fixture.mjs";

const header = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-TWITCH-LIVE-SEQUENCE:100\n";
const ad = header + '#EXT-X-DATERANGE:ID="ad",CLASS="twitch-stitched-ad",DURATION=2\n#EXT-X-DISCONTINUITY\n#EXTINF:2,Amazon|test\nad.ts\n';
let endpoint;
const server = http.createServer((request, response) => {
  const url = new URL(request.url, endpoint);
  response.setHeader("Cache-Control", "no-store");
  response.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; worker-src 'self' blob:; connect-src 'self'");
  if (url.pathname === "/api/v2/channel/hls/tester.m3u8") {
    response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    response.end(`#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60\n${endpoint}/media-${url.searchParams.get("variant") || "page"}.m3u8`);
    return;
  }
  if (url.pathname.startsWith("/media-")) {
    response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    const text = url.pathname.includes('recovery-clean') ? header + '#EXTINF:2,live\ncontent.ts\n' : ad;
    response.write(text.slice(0, 31));
    setTimeout(() => response.end(text.slice(31)), 25);
    return;
  }
  if (url.pathname === "/worker.js" || url.pathname === "/module-worker.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(`self.onmessage = async event => {
      if (!event.data?.run) return;
      try {
        if (event.data.master) await fetch(event.data.master).then(r=>r.text());
        const response = await fetch(event.data.media);
        self.postMessage({text:await response.text(),url:response.url});
      } catch(error) {self.postMessage({error:String(error)});}
    };`);
    return;
  }
  if (url.pathname === "/fixture.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(`
      (${installPlayerFixture.toString()})();
      window.runCase = async (mode, variant, sharedMaster = false) => {
        const master = location.origin + '/api/v2/channel/hls/tester.m3u8?variant=' + variant;
        const media = location.origin + '/media-' + variant + '.m3u8';
        if (mode === 'page' || sharedMaster) await fetch(master).then(r=>r.text());
        if (mode === 'page') { const response = await fetch(media); return {text:await response.text(),url:response.url}; }
        let worker;
        if (mode === 'blob' || mode === 'module') {
          const source = mode === 'module' ? 'import "' + location.origin + '/module-worker.js";' : 'importScripts("' + location.origin + '/worker.js");';
          const url = URL.createObjectURL(new Blob([source],{type:'text/javascript'}));
          worker = new Worker(url, mode === 'module' ? {type:'module'} : undefined);
          URL.revokeObjectURL(url);
        } else worker = new Worker('/worker.js');
        const result = await new Promise((resolve,reject) => {
          const timeout = setTimeout(()=>reject(new Error('Worker response timed out')),7000);
          worker.onmessage = event => {clearTimeout(timeout);resolve(event.data);};
          worker.onerror = event => {clearTimeout(timeout);reject(new Error(event.message));};
          worker.postMessage({run:true,master:sharedMaster?null:master,media});
        });
        worker.terminate(); return result;
      };
    `);
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><title>pUDblock Chrome fixture</title><body><script src="/fixture.js"></script></body>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
endpoint = `http://127.0.0.1:${server.address().port}`;
await fs.mkdir(path.join(root, ".test-artifacts"), { recursive: true });
const sourceDir = await fs.mkdtemp(path.join(root, ".test-artifacts", "chrome-"));
await fs.cp(path.join(root, "chrome"), sourceDir, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8"));
manifest.host_permissions.push("http://127.0.0.1/*");
for (const content of manifest.content_scripts) content.matches.push("http://127.0.0.1/*");
await fs.writeFile(path.join(sourceDir, "manifest.json"), JSON.stringify(manifest, null, 2));
const corePath = path.join(sourceDir, "core.js");
let core = await fs.readFile(corePath, "utf8");
core = core.replace('url.protocol === "https:" && (url.hostname === "ttvnw.net" || url.hostname.endsWith(".ttvnw.net"))', `url.origin === ${JSON.stringify(endpoint)}`);
await fs.writeFile(corePath, core);
for (const name of ["stream-runtime.js", "background.js"]) {
  const file = path.join(sourceDir, name);
  let source = await fs.readFile(file, "utf8");
  source = source.replaceAll('url.hostname === "usher.ttvnw.net"', 'url.hostname === "127.0.0.1"')
    .replace('url.protocol === "https:" && (url.hostname === "twitch.tv" || url.hostname.endsWith(".twitch.tv"))', `url.origin === ${JSON.stringify(endpoint)}`)
    .replaceAll('"https://*.ttvnw.net/*.m3u8*"', '"http://127.0.0.1/*.m3u8*"');
  await fs.writeFile(file, source);
}
let browser;
try {
  const launched = await launchChrome(sourceDir);
  browser = launched.browser;
  const ui = await browser.newPage();
  const errors = [];
  ui.on("pageerror", error => { errors.push(error.message); console.error("Popup error:", error.message); });
  await ui.goto(`chrome-extension://${launched.extensionId}/popup.html`);
  await ui.waitForFunction(() => document.getElementById("enabled").checked, { timeout: 5000 });
  await ui.click("#backups");
  await ui.waitForFunction(() => !document.getElementById("backups").checked && !document.getElementById("enabled").disabled);
  assert.equal(await ui.$eval("h1", node => node.textContent), "pUDblock");
  assert.equal(await ui.$eval("#support", node => node.href), "https://buymeacoffee.com/pudpodpid");
  const fixture = await browser.newPage();
  fixture.on("pageerror", error => errors.push(error.message));
  await fixture.goto(endpoint);
  await fixture.waitForFunction(() => typeof window.runCase === "function");
  for (const [mode, variant, shared] of [["page", "page", false], ["worker", "worker", false], ["blob", "blob", false], ["module", "module", false], ["blob", "cross-realm", true]]) {
    const result = await fixture.evaluate((mode, variant, shared) => window.runCase(mode, variant, shared), mode, variant, shared);
    assert.equal(result.error, undefined, `${mode} worker failed`);
    assert.match(result.text, /ad\.ts/, `${mode} must retain a playable window during fallback`);
    assert.match(result.text, /#EXTINF:/);
    assert.match(result.text, /MEDIA-SEQUENCE:100/);
    assert.equal(result.url, `${endpoint}/media-${variant}.m3u8`);
  }
  assert.ok(await fixture.evaluate(() => playerFixture.hidden && playerFixture.muted && playerFixture.overlay), 'fallback must cover and mute the player before releasing playlists');
  await fixture.evaluate(() => playerFixture.unmute());
  assert.equal(await fixture.evaluate(() => playerFixture.muted), true, 'the ad must stay muted');
  // The page and worker use the same guard. No reload occurs during the break.
  assert.equal(await fixture.evaluate(() => playerFixture.resets), 0);
  await fixture.evaluate(() => window.runCase('page', 'recovery-clean'));
  assert.equal(await fixture.evaluate(() => playerFixture.resets), 1);
  assert.equal(await fixture.evaluate(() => playerFixture.hidden), true, 'old buffered ads must stay hidden');
  await fixture.evaluate(() => playerFixture.replace());
  await fixture.waitForFunction(() => !playerFixture.hidden && !playerFixture.overlay, { polling: 100, timeout: 5000 });
  assert.equal(await fixture.evaluate(() => playerFixture.muted), false, 'restore the original mute preference after the player replaces its video');
  assert.equal(await fixture.evaluate(() => playerFixture.position > 1.5), true, 'seek to fresh content before unmuting');
  const tabId = await ui.evaluate(async endpoint => (await chrome.tabs.query({})).find(tab => tab.url?.startsWith(endpoint)).id, endpoint);
  const getStatus = () => ui.evaluate(tabId => chrome.runtime.sendMessage({ type: "status", tabId }), tabId);
  const until = Date.now() + 5000;
  while (((await getStatus()).status?.checked || 0) < 5 && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal((await getStatus()).status.filtered, 5);
  assert.equal((await getStatus()).diagnostics.variants, 1);
  assert.equal((await getStatus()).diagnostics.masters, 6);
  assert.match((await getStatus()).diagnostics.backupInfo, /switched off/, 'backup diagnostics must cross the actual page/content-script bridge');
  const workerTarget = browser.targets().find(target => target.type() === "service_worker" && target.url() === `chrome-extension://${launched.extensionId}/background.js`);
  const extensionWorker = await workerTarget.worker();
  await extensionWorker.close();
  assert.equal((await getStatus()).status.filtered, 5, "counters must survive service-worker suspension");
  await fixture.evaluate(() => window.runCase('page', 'before-disable'));
  assert.equal(await fixture.evaluate(() => playerFixture.hidden), true);
  await ui.evaluate(tabId => chrome.runtime.sendMessage({ type: "settings", changes: { enabled: false }, tabId }), tabId);
  const disabled = await fixture.evaluate(() => window.runCase("page", "disabled"));
  assert.match(disabled.text, /ad\.ts/);
  const disabledWorker = await fixture.evaluate(() => window.runCase("blob", "disabled-worker"));
  assert.match(disabledWorker.text, /ad\.ts/);
  assert.equal(await fixture.evaluate(() => playerFixture.overlay), false, 'turning filtering off must remove the waiting view');
  await ui.evaluate(tabId => chrome.runtime.sendMessage({ type: "settings", changes: { enabled: true }, tabId }), tabId);
  const enabled = await fixture.evaluate(() => window.runCase("blob", "enabled"));
  assert.match(enabled.text, /ad\.ts/);
  assert.ok(await fixture.evaluate(() => playerFixture.hidden && playerFixture.muted));
  await fixture.bringToFront();
  await ui.reload();
  await ui.waitForFunction(() => Number(document.getElementById("checked").textContent) > 0, {polling:100,timeout:5000});
  await ui.screenshot({ path: path.join(sourceDir, "popup.png"), clip: { x: 0, y: 0, width: 338, height: Math.min(800, await ui.$eval("body", node => node.scrollHeight)) } });
  assert.deepEqual(errors, []);
  console.log("Chrome smoke passed: popup, worker adapters, playable fallback, hidden/muted ads, clean recovery with one player reset, original volume restoration and service-worker restart.");
  console.log(`Popup screenshot: ${path.join(sourceDir, "popup.png")}`);
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
