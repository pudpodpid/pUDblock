// Compare anonymous backup resolution in Firefox's extension background and
// Chrome's Twitch page. Fresh profiles only. Signed URLs/tokens stay in memory;
// reports contain formats, HTTP outcomes and timing, never response bodies.
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import webExt from "web-ext";
import { root, launchChrome } from "./chrome-test-utils.mjs";
import "../firefox/core.js";

const channel = process.argv[2] || "caedrel";
if (!/^[a-z0-9_]{1,40}$/i.test(channel)) throw new Error("Provide a Twitch channel login");
const output = await fs.mkdtemp(path.join(root, ".test-artifacts", "backup-comparison-"));
const P = globalThis.StreamFilterCore;
const format = variant => ({ resolution: variant.resolution, frameRate: variant.frameRate, codecs: variant.codecs, audio: variant.audio });

// This function is bundled into the temporary Firefox copy and executed in
// Chrome's MAIN world. It performs the same four-second search as the extension.
async function probeBackups({ target, primary, apiVersion }) {
  const P = globalThis.StreamFilterCore;
  const nativeFetch = globalThis.__pudProbeFetch || globalThis.fetch.bind(globalThis);
  const calls = [];
  const formats = variants => variants.map(({ resolution, frameRate, codecs, audio }) => ({ resolution, frameRate, codecs, audio }));
  const anchor = text => ({
    liveSequence: /^#EXT-X-TWITCH-LIVE-SEQUENCE:(.+)$/m.exec(text)?.[1]?.trim() || null,
    elapsed: /^#EXT-X-TWITCH-ELAPSED-SECS:(.+)$/m.exec(text)?.[1]?.trim() || null
  });
  const trackedFetch = async (url, init) => {
    const parsed = new URL(url);
    const kind = parsed.hostname === "gql.twitch.tv" ? "token" : parsed.hostname === "usher.ttvnw.net" ? "master" : "media";
    const call = { kind, credentials: init.credentials };
    if (kind === "token") call.playerType = JSON.parse(init.body).variables.playerType;
    calls.push(call);
    const started = Date.now();
    try {
      const response = await nativeFetch(url, init);
      call.status = response.status;
      const text = await (typeof response.clone === "function" ? response.clone() : response).text();
      if (kind === "token") {
        const data = JSON.parse(text);
        call.hasToken = Boolean(data.data?.streamPlaybackAccessToken?.signature && data.data?.streamPlaybackAccessToken?.value);
        call.hasErrors = Boolean(data.errors?.length);
      } else if (P.isPlaylist(text)) {
        if (P.isMaster(text)) {
          const variants = P.parseVariants(text, url);
          call.formats = formats(variants);
          call.matchingFormat = Boolean(P.selectVariant(variants, target));
        } else {
          call.adMarkers = P.containsAds(text);
          call.segments = P.segmentCount(text);
          call.anchor = anchor(text);
          call.compatibleTimeline = P.compatibleTimeline(primary, text);
        }
      } else call.playlist = false;
      call.ms = Date.now() - started;
      return response;
    } catch (error) {
      call.error = error.name;
      call.ms = Date.now() - started;
      throw error;
    }
  };
  const resolver = new P.BackupResolver(trackedFetch);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  const started = Date.now();
  let diagnostic = "";
  try {
    const result = await resolver.resolve(globalThis.__pudProbeChannel, target, primary, controller.signal, apiVersion, info => { diagnostic = info; });
    const timeline = new P.Timeline();
    timeline.normalize("probe", primary);
    const usable = result && timeline.normalize("probe", result.content, { candidate: true });
    return { target, primaryAnchor: anchor(primary), apiVersion, found: Boolean(result), usable: Boolean(usable && P.segmentCount(usable)), playerType: result?.playerType || null, timedOut: controller.signal.aborted, diagnostic, ms: Date.now() - started, calls };
  } finally { clearTimeout(timeout); controller.abort(); }
}

async function firefoxProbe() {
  let resolve;
  let reject;
  const report = new Promise((yes, no) => { resolve = yes; reject = no; });
  report.catch(() => {});
  const server = http.createServer(async (request, response) => {
    if (request.url !== "/report") { response.writeHead(404).end(); return; }
    let body = "";
    for await (const part of request) body += part;
    response.end("ok");
    try { resolve(JSON.parse(body)); } catch (error) { reject(error); }
  });
  await new Promise(done => server.listen(0, "127.0.0.1", done));
  const endpoint = `http://127.0.0.1:${server.address().port}/report`;
  const source = path.join(output, "firefox");
  await fs.cp(path.join(root, "firefox"), source, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(source, "manifest.json"), "utf8"));
  manifest.permissions.push("http://127.0.0.1/*");
  manifest.background.scripts.push("qa-backups.js");
  await fs.writeFile(path.join(source, "manifest.json"), JSON.stringify(manifest, null, 2));
  let background = await fs.readFile(path.join(source, "background.js"), "utf8");
  background = background.replace("let count = 0;", "globalThis.__pudMaster = {variants: P.parseVariants(raw, details.url), apiVersion: new URL(details.url).pathname.startsWith('/api/v2/') ? 2 : 1}; let count = 0;")
    .replace("const key = contextKey(details);", "globalThis.__pudProbeFetch = resolverFor(details, context).fetcher; globalThis.__pudPrimary = {raw, variant: context.variant}; const key = contextKey(details);");
  await fs.writeFile(path.join(source, "background.js"), background);
  const qa = `globalThis.__pudProbeChannel = ${JSON.stringify(channel)};\nconst probeBackups = ${probeBackups.toString()};\n(async () => { try {
    await browser.tabs.create({url:${JSON.stringify(`https://www.twitch.tv/${channel}`)}});
    const until = Date.now()+30000;
    while ((!globalThis.__pudMaster || !globalThis.__pudPrimary) && Date.now()<until) await new Promise(resolve=>setTimeout(resolve,200));
    if (!globalThis.__pudPrimary) throw new Error('No primary playlist captured');
    const {raw, variant} = globalThis.__pudPrimary;
    const variants = globalThis.__pudMaster.variants;
    const cleanFormat = ({resolution,frameRate,codecs,audio}) => ({resolution,frameRate,codecs,audio});
    const source = cleanFormat(variants[0]);
    const result = await probeBackups({target:source,primary:raw,apiVersion:globalThis.__pudMaster.apiVersion});
    await fetch(${JSON.stringify(endpoint)},{method:'POST',body:JSON.stringify({browser:'firefox',transport:'twitch-page-via-extension-frame',primaryFormats:variants.map(cleanFormat),activeFormat:cleanFormat(variant),probe:result})});
  } catch(error) { await fetch(${JSON.stringify(endpoint)},{method:'POST',body:JSON.stringify({browser:'firefox',error:error.message})}); } })();`;
  await fs.writeFile(path.join(source, "qa-backups.js"), qa);
  const timeout = setTimeout(() => reject(new Error("Firefox backup probe timed out")), 50000);
  let runner;
  try {
    runner = await webExt.cmd.run({ sourceDir: source, firefox: process.env.FIREFOX_BINARY || "C:\\Program Files\\Mozilla Firefox\\firefox.exe", noReload: true, noInput: true, args: ["-headless"], pref: { "media.autoplay.default": 0, "media.autoplay.blocking_policy": 0 } }, { shouldExitProgram: false });
    return await report;
  } finally {
    clearTimeout(timeout);
    if (runner) await runner.exit();
    server.closeAllConnections();
    await new Promise(done => server.close(done));
  }
}

async function chromeProbe() {
  const source = path.join(output, "chrome");
  await fs.cp(path.join(root, "chrome"), source, { recursive: true });
  const manifest = JSON.parse(await fs.readFile(path.join(source, "manifest.json"), "utf8"));
  manifest.content_scripts.find(item => item.world === "MAIN").js.unshift("qa-capture.js");
  await fs.writeFile(path.join(source, "manifest.json"), JSON.stringify(manifest, null, 2));
  await fs.writeFile(path.join(source, "qa-capture.js"), `globalThis.__pudProbeFetch=fetch.bind(globalThis);globalThis.__pudProbeChannel=${JSON.stringify(channel)};`);
  const { browser } = await launchChrome(source);
  try {
    const page = await browser.newPage();
    let master;
    let primary;
    page.on("response", async response => {
      try {
        const url = new URL(response.url());
        if (!P.isTwitchStreamUrl(url.href) || !url.pathname.endsWith(".m3u8") || !response.ok()) return;
        const text = await response.text();
        if (!P.isPlaylist(text)) return;
        if (url.hostname === "usher.ttvnw.net" && P.isMaster(text)) master = { variants: P.parseVariants(text, url.href), apiVersion: url.pathname.startsWith("/api/v2/") ? 2 : 1 };
        else if (master && !P.isMaster(text)) {
          const variant = master.variants.find(variant => variant.url === url.href);
          if (variant) primary = { raw: text, variant };
        }
      } catch { /* Only complete live HLS responses are probe inputs. */ }
    });
    await page.goto(`https://www.twitch.tv/${channel}`, { waitUntil: "domcontentloaded", timeout: 30000 });
    const until = Date.now() + 30000;
    while ((!master || !primary) && Date.now() < until) {
      const warning = await page.evaluateHandle(() => [...document.querySelectorAll("button")].find(node => node.textContent.trim() === "Start Watching"));
      if (warning.asElement()) await warning.asElement().click();
      await warning.dispose();
      await new Promise(done => setTimeout(done, 200));
    }
    if (!primary) return { browser: "chrome", error: "No primary playlist captured" };
    const variants = master.variants.map(format);
    const result = await page.evaluate(probeBackups, { target: variants[0], primary: primary.raw, apiVersion: master.apiVersion });
    return { browser: "chrome", transport: "twitch-page", primaryFormats: variants, activeFormat: format(primary.variant), probe: result };
  } finally { await browser.close(); }
}

const results = await Promise.allSettled([firefoxProbe(), chromeProbe()]);
const report = results.map((result, index) => result.status === "fulfilled" ? result.value : { browser: index ? "chrome" : "firefox", error: result.reason.message });
await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
console.log(`Sanitized comparison: ${path.join(output, "report.json")}`);
if (report.some(result => result.error)) process.exitCode = 1;
