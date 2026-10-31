// Diagnostic check in a fresh headless profile. Reports only request categories,
// hostnames, status codes and the add-on's public status; never signed URLs.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import { fileURLToPath } from "node:url";
import webExt from "web-ext";
import assert from "node:assert/strict";

const root = fileURLToPath(new URL("../", import.meta.url));
const channel = process.argv[2] || "xqc";
if (!/^[a-zA-Z0-9_]{1,40}$/.test(channel)) throw new Error("Provide a Twitch channel login");
const firefox = process.env.FIREFOX_BINARY || (process.platform === "win32" ? "C:\\Program Files\\Mozilla Firefox\\firefox.exe" : "firefox");
let resolveReport;
let rejectReport;
const result = new Promise((resolve, reject) => { resolveReport = resolve; rejectReport = reject; });
result.catch(() => {});
const server = http.createServer(async (request, response) => {
  if (request.url !== "/report") { response.writeHead(404); response.end(); return; }
  let body = "";
  for await (const chunk of request) body += chunk;
  response.end("ok");
  try { resolveReport(JSON.parse(body)); } catch (error) { rejectReport(error); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const endpoint = `http://127.0.0.1:${server.address().port}`;
await fs.mkdir(path.join(root, ".test-artifacts"), { recursive: true });
const sourceDir = await fs.mkdtemp(path.join(root, ".test-artifacts", "live-"));
await fs.cp(path.join(root, "firefox"), sourceDir, { recursive: true });
const manifest = JSON.parse(await fs.readFile(path.join(sourceDir, "manifest.json"), "utf8"));
manifest.permissions.push("http://127.0.0.1/*");
manifest.background.scripts.unshift("qa-observe.js");
manifest.background.scripts.push("qa-start.js");
await fs.writeFile(path.join(sourceDir, "manifest.json"), JSON.stringify(manifest, null, 2));
await fs.writeFile(path.join(sourceDir, "qa-observe.js"), `
globalThis.liveProbe = { requests: [], errors: [], pipeline: [] };
function summarize(details) {
  const url = new URL(details.url);
  const kind = url.hostname === 'usher.ttvnw.net' ? url.pathname : url.hostname === 'gql.twitch.tv' ? 'graphql' : url.pathname.endsWith('.m3u8') ? 'media-playlist' : 'segment-or-other';
  return {host: url.hostname, kind, tabId: details.tabId, type: details.type};
}
browser.webRequest.onBeforeRequest.addListener(details => {
  if (liveProbe.requests.length < 180) liveProbe.requests.push(summarize(details));
}, {urls: ['https://*.ttvnw.net/*', 'https://gql.twitch.tv/gql*']});
browser.webRequest.onErrorOccurred.addListener(details => {
  if (liveProbe.errors.length < 30) liveProbe.errors.push({...summarize(details), error: details.error});
}, {urls: ['https://*.ttvnw.net/*', 'https://gql.twitch.tv/gql*']});
`);
const backgroundPath = path.join(sourceDir, "background.js");
let background = await fs.readFile(backgroundPath, "utf8");
background = background.replace("const channel = identifyMaster(details);", "const channel = identifyMaster(details); if (globalThis.liveProbe?.pipeline.length < 120) globalThis.liveProbe.pipeline.push({channel, tabId: details.tabId, mapped: contexts.has(contextKey(details))});");
await fs.writeFile(backgroundPath, background);
await fs.writeFile(path.join(sourceDir, "qa-start.js"), `
(async () => {
  const tab = await browser.tabs.create({url: ${JSON.stringify(`https://www.twitch.tv/${channel}`)}});
  globalThis.liveProbe.tabId = tab.id;
  setTimeout(() => browser.tabs.create({url: browser.runtime.getURL('qa-report.html')}), 30000);
})();
`);
await fs.writeFile(path.join(sourceDir, "qa-report.html"), '<!doctype html><script src="qa-report.js"></script>');
await fs.writeFile(path.join(sourceDir, "qa-report.js"), `
(async () => {
  const probe = browser.extension.getBackgroundPage().liveProbe;
  const state = await browser.runtime.sendMessage({type: 'status', tabId: probe.tabId});
  await fetch(${JSON.stringify(endpoint + "/report")}, {method: 'POST', body: JSON.stringify({requests: probe.requests, errors: probe.errors, pipeline: probe.pipeline, state})});
})();
`);
let runner;
const timeout = setTimeout(() => rejectReport(new Error("Live check timed out after 50 seconds")), 50000);
try {
  runner = await webExt.cmd.run({ sourceDir, firefox, noReload: true, noInput: true, args: ["-headless"], pref: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 } }, { shouldExitProgram: false });
  const report = await result;
  await fs.writeFile(path.join(sourceDir, "report.json"), JSON.stringify(report, null, 2));
  const uniqueRequests = [...new Set(report.requests.map(item => `${item.kind} | tab ${item.tabId} | ${item.type}`))];
  console.log(JSON.stringify({ requests: uniqueRequests, errors: report.errors, pipelineSamples: report.pipeline.slice(0, 6), state: report.state }, null, 2));
  console.log(`Sanitized report: ${path.join(sourceDir, "report.json")}`);
  assert.ok(report.state?.status?.checked > 0, "No live playlists were checked; the channel may be offline or playback unavailable");
  assert.equal(report.state.diagnostics?.issue, null, "Playlist filtering reported an error");
} finally {
  clearTimeout(timeout);
  if (runner) await runner.exit();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
