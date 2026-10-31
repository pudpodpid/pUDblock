// Run the real Firefox StreamFilter against a local fixture server in a fresh
// profile. Only fixture host matching and the backup setting are changed in
// this disposable copy; shipped source and your browser profile are untouched.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import webExt from "web-ext";
import { installPlayerFixture } from "./player-guard-fixture.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const firefox = process.env.FIREFOX_BINARY || (process.platform === "win32" ? "C:\\Program Files\\Mozilla Firefox\\firefox.exe" : "firefox");
const header = "#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:7\n#EXT-X-TWITCH-LIVE-SEQUENCE:100\n";
const ad = header + '#EXT-X-DATERANGE:ID="ad",CLASS="twitch-stitched-ad",DURATION=2\n#EXT-X-DISCONTINUITY\n#EXTINF:2,Amazon|test\nad.ts\n';
let endpoint;
let uiReport;
let serveClean = false;
let resolveResults;
let rejectResults;
const results = new Promise((resolve, reject) => { resolveResults = resolve; rejectResults = reject; });
// Attach before starting the browser so an early fixture failure is handled.
results.catch(() => {});
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, endpoint);
  if (url.pathname === '/set-clean') { serveClean = true; response.end('ok'); return; }
  if (url.pathname === "/ui-report") {
    let body = "";
    for await (const chunk of request) body += chunk;
    uiReport = JSON.parse(body);
    if (uiReport.error) rejectResults(new Error(uiReport.error));
    response.end("ok");
    return;
  }
  if (url.pathname === "/report") {
    let body = "";
    for await (const chunk of request) body += chunk;
    response.end("ok");
    try { const report = JSON.parse(body); report.error ? rejectResults(new Error(report.error)) : resolveResults({ ...report, ui: uiReport }); }
    catch (error) { rejectResults(error); }
    return;
  }
  response.setHeader("Cache-Control", "no-store");
  if (url.pathname === "/fixture.js" || url.pathname === "/worker.js") {
    response.setHeader("Content-Type", "text/javascript; charset=utf-8");
    if (url.pathname === "/worker.js") {
      response.end(`onmessage = async () => { try { await fetch('${endpoint}/api/v2/channel/hls/tester.m3u8?worker=1').then(r=>r.text()); const media = await fetch('${endpoint}/media-worker.m3u8').then(r=>r.text()); postMessage({media}); } catch(error) { postMessage({error: String(error)}); } };`);
    } else {
      response.end(`(${installPlayerFixture.toString()})(); (async () => { try {
        await fetch('/api/v2/channel/hls/tester.m3u8').then(r => r.text());
        const media = await fetch('/media.m3u8').then(r => r.text());
        const worker = new Worker('/worker.js');
        const workerResult = await new Promise((resolve, reject) => { worker.onmessage = event => resolve(event.data); worker.onerror = event => reject(new Error(event.message)); worker.postMessage('go'); });
        worker.terminate();
        const blobUrl = URL.createObjectURL(new Blob([${JSON.stringify(`importScripts('${endpoint}/worker.js');`)}], {type: 'text/javascript'}));
        const blobWorker = new Worker(blobUrl);
        const blobResult = await new Promise((resolve, reject) => { blobWorker.onmessage = event => resolve(event.data); blobWorker.onerror = event => reject(new Error(event.message)); blobWorker.postMessage('go'); });
        blobWorker.terminate(); URL.revokeObjectURL(blobUrl);
        if (!playerFixture.hidden || !playerFixture.muted || !playerFixture.overlay) throw new Error('Fallback must hide and mute the player');
        if (playerFixture.resets !== 0) throw new Error('Do not reload the player during an ad break');
        playerFixture.unmute();
        if (!playerFixture.muted) throw new Error('The ad must stay muted');
        await fetch('/set-clean');
        await fetch('/media.m3u8').then(r=>r.text());
        if (playerFixture.resets !== 1 || !playerFixture.hidden) throw new Error('Clean recovery must reset once and keep old buffered ads hidden');
        playerFixture.replace();
        const until = Date.now() + 5000;
        while ((playerFixture.hidden || playerFixture.overlay) && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 50));
        if (playerFixture.hidden || playerFixture.overlay || playerFixture.muted || playerFixture.position < 1.5) throw new Error('Clean recovery must restore video and the original sound preference at the live edge');
        await fetch('/report', { method: 'POST', body: JSON.stringify({media, worker: workerResult, blob: blobResult}) });
      } catch(error) { await fetch('/report', { method: 'POST', body: JSON.stringify({error: String(error)}) }); } })();`);
    }
    return;
  }
  if (url.pathname === "/api/v2/channel/hls/tester.m3u8") {
    response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    const variant = url.searchParams.has("worker") ? "/media-worker.m3u8" : "/media.m3u8";
    response.end(`#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60\n${endpoint}${variant}`);
    return;
  }
  if (url.pathname.startsWith("/media")) {
    response.setHeader("Content-Type", "application/vnd.apple.mpegurl");
    const text = serveClean ? header + '#EXTINF:2,live\ncontent.ts\n' : ad;
    response.write(text.slice(0, 23));
    setTimeout(() => response.end(text.slice(23)), 30);
    return;
  }
  response.setHeader("Content-Type", "text/html");
  response.end('<!doctype html><title>pUDblock fixture</title><body><script src="/fixture.js"></script></body>');
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
endpoint = `http://127.0.0.1:${server.address().port}`;
await fs.mkdir(path.join(root, ".test-artifacts"), { recursive: true });
const sourceDir = await fs.mkdtemp(path.join(root, ".test-artifacts", "firefox-"));
await fs.cp(path.join(root, "firefox"), sourceDir, { recursive: true });
const manifestPath = path.join(sourceDir, "manifest.json");
const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
manifest.permissions.push("http://127.0.0.1/*");
for (const content of manifest.content_scripts) content.matches.push("http://127.0.0.1/*");
manifest.background.scripts.push("qa-start.js");
await fs.writeFile(manifestPath, JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(sourceDir, "qa-start.js"), 'browser.tabs.create({ url: browser.runtime.getURL("qa-ui.html") });');
await fs.writeFile(path.join(sourceDir, "qa-ui.html"), '<!doctype html><title>Popup QA</title><iframe src="popup.html" id="popup"></iframe><script src="qa-ui.js"></script>');
await fs.writeFile(path.join(sourceDir, "qa-ui.js"), `
const endpoint = ${JSON.stringify(endpoint)};
async function waitFor(check) {
  const until = Date.now() + 5000;
  while (Date.now() < until) { if (await check()) return; await new Promise(resolve => setTimeout(resolve, 25)); }
  throw new Error('Popup state did not update');
}
(async () => { try {
  let popup;
  await waitFor(() => { popup = document.getElementById('popup').contentDocument; return popup?.getElementById('state')?.textContent === 'No stream requests detected'; });
  popup.getElementById('enabled').click();
  await waitFor(async () => (await browser.storage.local.get('enabled')).enabled === false && popup.getElementById('state').textContent === 'Filtering is off');
  if (!popup.getElementById('backups').disabled) throw new Error('Disabled filtering must disable the backup switch');
  popup.getElementById('enabled').click();
  await waitFor(async () => (await browser.storage.local.get('enabled')).enabled === true && popup.getElementById('state').textContent === 'No stream requests detected');
  popup.getElementById('backups').click();
  await waitFor(async () => (await browser.storage.local.get('backups')).backups === true);
  await waitFor(() => !popup.getElementById('backups').disabled);
  popup.getElementById('backups').click();
  await waitFor(async () => (await browser.storage.local.get('backups')).backups === false);
  await fetch(endpoint + '/ui-report', {method: 'POST', body: JSON.stringify({passed: true})});
  await browser.tabs.create({url: endpoint + '/'});
} catch(error) { await fetch(endpoint + '/ui-report', {method: 'POST', body: JSON.stringify({error: String(error)})}); } })();
`);
const backgroundPath = path.join(sourceDir, "background.js");
let background = await fs.readFile(backgroundPath, "utf8");
background = background.replaceAll('"https://*.ttvnw.net/*.m3u8*"', '"http://127.0.0.1/*.m3u8*"')
  .replace('url.hostname === "usher.ttvnw.net"', 'url.hostname === "127.0.0.1"')
  .replace("if (P.isTwitchStreamUrl(variant.url))", `if (new URL(variant.url).origin === ${JSON.stringify(endpoint)})`)
  .replace("enabled: true, backups: true", "enabled: true, backups: false");
await fs.writeFile(backgroundPath, background);
let runner;
const timeout = setTimeout(() => rejectResults(new Error("Firefox fixture timed out after 45 seconds")), 45000);
try {
  runner = await webExt.cmd.run({ sourceDir, firefox, noReload: true, noInput: true, args: ["-headless"] }, { shouldExitProgram: false });
  const report = await results;
  assert.equal(report.ui?.passed, true);
  assert.match(report.media, /ad\.ts/);
  assert.match(report.media, /#EXTINF:/);
  assert.match(report.media, /#EXT-X-MEDIA-SEQUENCE:100/);
  assert.equal(report.worker.error, undefined);
  assert.match(report.worker.media, /ad\.ts/);
  assert.match(report.worker.media, /#EXTINF:/);
  assert.equal(report.blob.error, undefined);
  assert.match(report.blob.media, /ad\.ts/);
  assert.match(report.blob.media, /#EXTINF:/);
  console.log("Firefox smoke passed: popup, page/worker fallback, hidden/muted ads, clean recovery with one player reset and original volume restoration.");
} finally {
  clearTimeout(timeout);
  if (runner) await runner.exit();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
