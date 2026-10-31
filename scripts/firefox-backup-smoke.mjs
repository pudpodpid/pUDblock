// Native Firefox integration test: the extension background cannot fetch backup
// endpoints. Fixed anonymous page requests must still replace ads in page and
// worker playlists without recursively entering the response filter.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import webExt from "web-ext";
import { root } from "./chrome-test-utils.mjs";
import { installPlayerFixture } from "./player-guard-fixture.mjs";

const header = '#EXTM3U\n#EXT-X-TARGETDURATION:2\n#EXT-X-MEDIA-SEQUENCE:100\n#EXT-X-TWITCH-LIVE-SEQUENCE:1000\n';
const ad = header + '#EXT-X-CUE-OUT:2\n#EXTINF:2,Amazon|test\nad.ts\n';
const clean = header + '#EXTINF:2,live\nclean.ts\n';
let endpoint;
let pageReport;
let denyTokens = false;
const stats = { tokenCalls: 0, tokenOrigins: [], credentialsOmitted: true, backupMasters: 0, backupMedia: 0 };
let resolve;
let reject;
const result = new Promise((yes, no) => { resolve = yes; reject = no; });
result.catch(() => {});
const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, endpoint);
  response.setHeader('Cache-Control', 'no-store');
  if (url.pathname === '/done' && request.method === 'POST') {
    let body = ''; for await (const part of request) body += part;
    pageReport = JSON.parse(body); response.end('ok'); return;
  }
  if (url.pathname === '/done') { response.end(JSON.stringify({ done: Boolean(pageReport) })); return; }
  if (url.pathname === '/final') {
    let body = ''; for await (const part of request) body += part;
    response.end('ok'); resolve({ page: pageReport, background: JSON.parse(body), stats }); return;
  }
  if (url.pathname === '/deny-tokens') { denyTokens = true; response.end('ok'); return; }
  if (url.pathname === '/gql') {
    stats.tokenCalls++;
    stats.tokenOrigins.push(request.headers.origin || 'none');
    stats.credentialsOmitted &&= !request.headers.cookie && !request.headers.authorization;
    let body = ''; for await (const part of request) body += part;
    const query = JSON.parse(body);
    assert.ok(['popout', 'embed'].includes(query.variables.playerType));
    response.setHeader('Content-Type', 'application/json');
    if (denyTokens) { response.writeHead(403); response.end('{}'); return; }
    response.end(JSON.stringify({ data: { streamPlaybackAccessToken: { signature: 'fixture-signature', value: 'fixture-token' } } })); return;
  }
  if (url.pathname === '/api/v2/channel/hls/tester.m3u8') {
    const backup = url.searchParams.has('sig');
    if (backup) stats.backupMasters++;
    response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    response.end(`#EXTM3U\n#EXT-X-STREAM-INF:RESOLUTION=1920x1080,FRAME-RATE=60,CODECS="avc1.64002A,mp4a.40.2"\n${endpoint}/${backup ? 'backup-media' : 'media'}.m3u8`); return;
  }
  if (url.pathname === '/media.m3u8' || url.pathname === '/backup-media.m3u8') {
    const backup = url.pathname.startsWith('/backup-');
    if (backup) stats.backupMedia++;
    response.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    response.end(backup ? clean : ad); return;
  }
  if (url.pathname === '/worker.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`onmessage = async () => { try { await fetch('${endpoint}/api/v2/channel/hls/tester.m3u8').then(r=>r.text()); postMessage({text:await fetch('${endpoint}/media.m3u8').then(r=>r.text())}); } catch(error) { postMessage({error:error.message}); } };`); return;
  }
  if (url.pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript');
    response.end(`(${installPlayerFixture.toString()})(); (async () => { try {
      const texts = [];
      await fetch('/api/v2/channel/hls/tester.m3u8').then(r=>r.text());
      texts.push(await fetch('/media.m3u8').then(r=>r.text()));
      for (const blob of [false,true]) {
        let worker;
        if (blob) {
          const url = URL.createObjectURL(new Blob(['importScripts("'+location.origin+'/worker.js");'],{type:'text/javascript'}));
          worker = new Worker(url); URL.revokeObjectURL(url);
        } else worker = new Worker('/worker.js');
        const report = await new Promise((resolve,reject) => { worker.onmessage=event=>resolve(event.data);worker.onerror=event=>reject(new Error(event.message));worker.postMessage('go'); });
        worker.terminate(); if(report.error)throw new Error(report.error); texts.push(report.text);
      }
      const coveredDuringBackups = playerFixture.overlay;
      await fetch('/deny-tokens');
      await fetch('/api/v2/channel/hls/tester.m3u8?session=failure').then(r=>r.text());
      const failed = await fetch('/media.m3u8').then(r=>r.text());
      await fetch('/done',{method:'POST',body:JSON.stringify({texts,coveredDuringBackups,failed,hidden:playerFixture.hidden,muted:playerFixture.muted})});
    } catch(error) { await fetch('/done',{method:'POST',body:JSON.stringify({error:error.message})}); } })();`); return;
  }
  response.setHeader('Content-Type', 'text/html');
  response.setHeader('Set-Cookie', 'pudblock-fixture=not-for-backups; SameSite=Lax');
  response.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; connect-src 'self'; worker-src 'self' blob:");
  response.end('<!doctype html><title>Firefox backup transport fixture</title><body><script src="/fixture.js"></script></body>');
});
await new Promise(done => server.listen(0,'127.0.0.1',done));
endpoint = `http://127.0.0.1:${server.address().port}`;
const sourceDir = await fs.mkdtemp(path.join(root,'.test-artifacts','firefox-backup-'));
await fs.cp(path.join(root,'firefox'),sourceDir,{recursive:true});
const manifest = JSON.parse(await fs.readFile(path.join(sourceDir,'manifest.json'),'utf8'));
manifest.permissions.push('http://127.0.0.1/*');
for(const entry of manifest.content_scripts)entry.matches.push('http://127.0.0.1/*');
manifest.background.scripts.unshift('qa-block-fetch.js');
manifest.background.scripts.push('qa-backup.js');
await fs.writeFile(path.join(sourceDir,'manifest.json'),JSON.stringify(manifest,null,2));
for(const name of ['core.js','background.js','backup-transport.js']) {
  const file = path.join(sourceDir,name);
  let code = await fs.readFile(file,'utf8');
  code = code.replaceAll('https://gql.twitch.tv/gql',endpoint+'/gql')
    .replaceAll('https://usher.ttvnw.net/api/',endpoint+'/api/')
    .replaceAll('url.hostname === "usher.ttvnw.net"','url.hostname === "127.0.0.1"')
    .replaceAll('"https://*.ttvnw.net/*.m3u8*"','"http://127.0.0.1/*.m3u8*"')
    .replace('url.protocol === "https:" && (url.hostname === "ttvnw.net" || url.hostname.endsWith(".ttvnw.net"))',`url.origin === ${JSON.stringify(endpoint)}`);
  await fs.writeFile(file,code);
}
await fs.writeFile(path.join(sourceDir,'qa-block-fetch.js'), `
globalThis.qaBackgroundCalls = 0;
const qaOriginalFetch = fetch;
globalThis.fetch = (url,init) => {
  if (String(url).includes('/gql') || String(url).includes('/api/v2/') || String(url).includes('/backup-media')) { qaBackgroundCalls++; return Promise.reject(new TypeError('Background backup fetch deliberately blocked')); }
  return qaOriginalFetch(url,init);
};`);
await fs.writeFile(path.join(sourceDir,'qa-backup.js'), `
(async () => {
  globalThis.qaTab = await browser.tabs.create({url:${JSON.stringify(endpoint)}});
  const until = Date.now()+25000;
  while(Date.now()<until) { const result=await fetch(${JSON.stringify(endpoint+'/done')}).then(r=>r.json());if(result.done)break;await new Promise(resolve=>setTimeout(resolve,100)); }
  await browser.tabs.create({url:browser.runtime.getURL('qa-report.html')});
})();`);
await fs.writeFile(path.join(sourceDir,'qa-report.html'),'<!doctype html><script src="qa-report.js"></script>');
await fs.writeFile(path.join(sourceDir,'qa-report.js'), `(async()=>{ const bg=browser.extension.getBackgroundPage();const state=await browser.runtime.sendMessage({type:'status',tabId:bg.qaTab.id});await fetch(${JSON.stringify(endpoint+'/final')},{method:'POST',body:JSON.stringify({state,backgroundCalls:bg.qaBackgroundCalls})}); })();`);
const timeout = setTimeout(()=>reject(new Error('Firefox backup fixture timed out')),40000);
let runner;
try {
  runner = await webExt.cmd.run({sourceDir,firefox:process.env.FIREFOX_BINARY || 'C:\\Program Files\\Mozilla Firefox\\firefox.exe',noReload:true,noInput:true,args:['-headless']},{shouldExitProgram:false});
  const report = await result;
  assert.equal(report.page.error,undefined);
  assert.equal(report.page.texts.length,3);
  for(const text of report.page.texts){assert.match(text,/clean\.ts/);assert.doesNotMatch(text,/ad\.ts/);}
  assert.equal(report.page.coveredDuringBackups,false);
  assert.ok(report.page.hidden && report.page.muted);
  assert.match(report.page.failed,/ad\.ts/);
  assert.equal(report.background.backgroundCalls,0);
  assert.equal(report.background.state.status.backups,3);
  assert.equal(report.background.state.status.filtered,1);
  assert.equal(report.background.state.diagnostics.masters,4,'own backup masters must never recursively enter the filter');
  assert.match(report.background.state.diagnostics.backupInfo,/403.*token.*embed.*403.*token/);
  assert.equal(stats.backupMasters,3);
  assert.equal(stats.backupMedia,3);
  assert.equal(stats.tokenCalls,5);
  assert.ok(stats.tokenOrigins.every(origin=>origin===endpoint));
  assert.equal(stats.credentialsOmitted,true);
  console.log('Firefox backup smoke passed: background fetch blocked; anonymous page token/playlist requests replaced ads in a page and classic/Blob workers; no recursion; server rejections keep the hidden/muted fallback.');
} finally {
  clearTimeout(timeout);
  if(runner)await runner.exit();
  server.closeAllConnections();
  await new Promise(done=>server.close(done));
}
