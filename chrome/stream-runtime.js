/*
 * Copyright (c) 2026 pudpodpid. MIT licensed; see LICENSE.
 * Chrome page/worker transport for the shared playlist filtering engine.
 * This function is self-contained so it can be installed in a Blob Worker.
 */
function installPudblockRuntime(scope, initialSettings, publishContexts, publishEvent) {
  "use strict";
  const P = scope.StreamFilterCore;
  const originalFetch = scope.fetch.bind(scope);
  const contexts = new Map();
  const timeline = new P.Timeline();
  const resolver = new P.BackupResolver(originalFetch);
  const active = new Set();
  let settings = { enabled: false, backups: true, initialized: false, ...initialSettings };
  let revision = 0;
  let readyResolve;
  const ready = new Promise(resolve => { readyResolve = resolve; });
  const readinessTimeout = setTimeout(() => readyResolve(), 1000);
  if (settings.initialized) { clearTimeout(readinessTimeout); readyResolve(); }

  function report(event) {
    try { return Promise.resolve(publishEvent(event)).catch(() => {}); }
    catch { return Promise.resolve(); }
  }
  function requestUrl(input) {
    try { return new URL(typeof input === "string" ? input : input?.url || input?.href, scope.location.href); }
    catch { return null; }
  }
  function isPlaylistUrl(url) {
    return Boolean(url && P.isTwitchStreamUrl(url.href) && url.pathname.endsWith(".m3u8"));
  }
  function learnContexts(entries) {
    for (const entry of entries.slice(0, 64)) {
      if (!P.isTwitchStreamUrl(entry?.variant?.url) || !/^[a-z0-9_]{1,40}$/i.test(entry.channel || "")) continue;
      contexts.delete(entry.variant.url);
      contexts.set(entry.variant.url, { ...entry, updated: Date.now() });
    }
    while (contexts.size > 512) contexts.delete(contexts.keys().next().value);
  }
  function updateSettings(next) {
    const enabled = typeof next.enabled === "boolean" ? next.enabled : settings.enabled;
    const backups = typeof next.backups === "boolean" ? next.backups : settings.backups;
    const changed = enabled !== settings.enabled || backups !== settings.backups || !settings.initialized;
    settings = { enabled, backups, initialized: true };
    clearTimeout(readinessTimeout); readyResolve();
    if (changed) {
      revision++;
      for (const controller of active) controller.abort();
      timeline.clear(); resolver.clear();
    }
  }
  async function readPlaylist(response, signal) {
    const clone = response.clone();
    const reader = clone.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    let size = 0;
    let text = "";
    try {
      while (true) {
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 1024 * 1024) throw new Error("Playlist response exceeded the size limit");
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally { reader.cancel().catch(() => {}); }
  }
  function replacement(response, text) {
    const headers = new Headers(response.headers);
    for (const name of ["content-length", "content-encoding", "content-md5", "etag"]) headers.delete(name);
    const result = new Response(text, { status: response.status, statusText: response.statusText, headers });
    // Preserve metadata the player normally receives from the original fetch.
    for (const name of ["url", "type", "redirected"]) Object.defineProperty(result, name, { value: response[name] });
    return result;
  }

  async function process(response, url, requestSignal) {
    await ready;
    if (!settings.enabled || requestSignal?.aborted) return response;
    const channel = url.hostname === "usher.ttvnw.net" ? /^\/api\/(?:v2\/)?channel\/hls\/([a-z0-9_]+)\.m3u8$/i.exec(url.pathname)?.[1]?.toLowerCase() : null;
    const context = contexts.get(url.href);
    if (!channel && (!context || Date.now() - context.updated > 6 * 60 * 60 * 1000)) return response;
    if (!response.ok) {
      report({ kind: "issue", channel: channel || context?.channel, issue: "The stream server rejected a playlist request." });
      return response;
    }
    let raw;
    try { raw = await readPlaylist(response, requestSignal); }
    catch {
      if (!requestSignal?.aborted) report({ kind: "issue", channel: channel || context?.channel, issue: "A playlist response could not be read; original playback was kept." });
      return response;
    }
    if (!settings.enabled || requestSignal?.aborted) return response;
    if (!P.isPlaylist(raw)) {
      report({ kind: "issue", channel: channel || context?.channel, issue: "The stream server returned a response that is not a playlist." });
      return response;
    }
    if (channel) {
      const apiVersion = url.pathname.startsWith("/api/v2/") ? 2 : 1;
      const variants = P.parseVariants(raw, response.url || url.href).filter(variant => P.isTwitchStreamUrl(variant.url));
      const entries = variants.map(variant => ({ channel, apiVersion, variant }));
      learnContexts(entries);
      publishContexts(entries);
      report({ kind: "master", channel, apiVersion, variants: entries.length });
      return response;
    }
    if (P.isMaster(raw)) return response;
    if (/^#EXT-X-(?:KEY:(?!METHOD=NONE)|BYTERANGE:)/m.test(raw)) {
      report({ kind: "issue", channel: context.channel, issue: "This stream uses encryption or byte ranges that pUDblock cannot filter." });
      return response;
    }
    const result = async (name, content) => {
      const resultRevision = revision;
      await report({ kind: "result", channel: context.channel, result: name });
      if (!settings.enabled || revision !== resultRevision || requestSignal?.aborted) return response;
      return content === raw ? response : replacement(response, content);
    };
    if (!P.containsAds(raw)) return result("clean", timeline.normalize(url.href, raw));

    const startedRevision = revision;
    const controller = new AbortController();
    const abort = () => controller.abort();
    active.add(controller);
    requestSignal?.addEventListener("abort", abort, { once: true });
    const deadline = setTimeout(() => controller.abort("backup-timeout"), 4000);
    let backup = null;
    let backupInfo = settings.backups ? "Backup search ended without a usable stream." : "Alternate streams are switched off.";
    try {
      if (settings.backups) backup = await resolver.resolve(context.channel, context.variant, raw, controller.signal, context.apiVersion, info => { backupInfo = info; });
    } catch { backupInfo = "The backup search failed; no compatible clean stream was selected."; }
    finally { clearTimeout(deadline); active.delete(controller); requestSignal?.removeEventListener("abort", abort); }
    if (!settings.enabled || revision !== startedRevision || requestSignal?.aborted) return response;
    if (backup) {
      const content = timeline.normalize(url.href, backup.content, { candidate: true });
      if (content && P.segmentCount(content)) {
        await report({ kind: "backup-info", channel: context.channel, info: backupInfo });
        return result("backup", content);
      }
      backupInfo = ("Clean backup rejected: older than the current playback window. " + backupInfo).slice(0, 700);
    }
    await report({ kind: "backup-info", channel: context.channel, info: backupInfo });
    // An empty live playlist makes Twitch stop requesting refreshes. Preserve
    // the playable window and acknowledge the hidden/muted waiting view first.
    return result("waiting", timeline.normalize(url.href, raw));
  }

  scope.fetch = function pudblockFetch(input, init) {
    const url = requestUrl(input);
    const response = originalFetch(input, init);
    if (!isPlaylistUrl(url)) return response;
    const signal = init?.signal || (typeof input === "object" ? input?.signal : undefined);
    return response.then(value => process(value, url, signal).catch(() => {
      report({ kind: "issue", issue: "A playlist could not be processed; original playback was kept." });
      return value;
    }));
  };
  return { updateSettings, learnContexts };
}
globalThis.PudblockInstallRuntime = installPudblockRuntime;
