/* global browser */
"use strict";

(() => {
  const P = globalThis.StreamFilterCore;
  const extensionRoot = browser.runtime.getURL("");
  const contexts = new Map();
  const statuses = new Map();
  const diagnostics = new Map();
  const active = new Map();
  const timeline = new P.Timeline();
  const resolvers = new Map();
  const pageRequests = new Map();
  let settings = { enabled: true, backups: true };
  let revision = 0;
  const ready = browser.storage.local.get(["enabled", "backups"]).then(saved => {
    for (const key of Object.keys(settings)) if (typeof saved[key] === "boolean") settings[key] = saved[key];
  }).catch(() => {});

  function remember(map, key, value, limit = 128) {
    map.delete(key); map.set(key, value);
    while (map.size > limit) map.delete(map.keys().next().value);
  }
  function contextKey(details, url = details.url) { return `${details.tabId}|${url}`; }
  function frame(details) { return details.frameId >= 0 ? details.frameId : 0; }
  function pageKey(details, url = details.url) { return `${details.tabId}|${frame(details)}|${url}`; }
  function isPageBackup(details) {
    const key = pageKey(details);
    const value = pageRequests.get(key);
    if (!value) return false;
    if (value.count > 0 || value.expires > Date.now()) return true;
    pageRequests.delete(key);
    return false;
  }
  function resolverFor(details, context) {
    const key = `${details.tabId}|${frame(details)}|${context.sessionId}`;
    if (!resolvers.has(key)) {
      const fetcher = globalThis.PudblockCreatePageFetcher(browser, details.tabId, frame(details), {
        start(url) {
          const requestKey = pageKey(details, url);
          const value = pageRequests.get(requestKey) || { count: 0, expires: 0 };
          value.count++; value.expires = Infinity;
          remember(pageRequests, requestKey, value, 1024);
        },
        end(url) {
          const value = pageRequests.get(pageKey(details, url));
          if (value) { value.count = Math.max(0, value.count - 1); value.expires = Date.now() + 5000; }
        }
      });
      remember(resolvers, key, new P.BackupResolver(fetcher), 128);
    }
    return resolvers.get(key);
  }
  function diagnostic(tabId, changes = {}) {
    const value = diagnostics.get(tabId) || { requests: 0, masters: 0, variants: 0, lastRequest: null, channel: null, issue: null };
    Object.assign(value, changes);
    remember(diagnostics, tabId, value);
    return value;
  }
  function status(tabId, result, channel) {
    if (tabId < 0) return;
    const previous = statuses.get(tabId);
    const value = previous?.channel === channel ? previous : { channel, filtered: 0, backups: 0, checked: 0 };
    if (result !== "error") { value.checked++; value.lastChecked = Date.now(); }
    if (result === "filtered" || result === "waiting") value.filtered++;
    if (result === "backup") value.backups++;
    value.result = result; value.lastSeen = Date.now();
    if (result !== "error") diagnostic(tabId, { issue: null });
    remember(statuses, tabId, value);
    const badge = { clean: "ON", backup: "ALT", filtered: "CUT", waiting: "WAIT", error: "!" }[result] || "ON";
    browser.browserAction.setBadgeText({ tabId, text: badge }).catch(() => {});
    browser.browserAction.setBadgeBackgroundColor({ tabId, color: result === "error" ? "#bd4e56" : result === "waiting" || result === "filtered" ? "#9c6b24" : "#236e5b" }).catch(() => {});
  }

  function identifyMaster(details) {
    const url = new URL(details.url);
    return url.hostname === "usher.ttvnw.net" ? /^\/api\/(?:v2\/)?channel\/hls\/([a-z0-9_]+)\.m3u8$/i.exec(url.pathname)?.[1]?.toLowerCase() : null;
  }

  async function present(details, waiting, channel) {
    try {
      const result = await browser.tabs.sendMessage(details.tabId, { type: "pudblock-player", waiting, channel }, { frameId: details.frameId >= 0 ? details.frameId : 0 });
      return result?.ok === true;
    } catch { return false; }
  }

  async function transform(details, raw, channel, context, signal, startedRevision) {
    if (!settings.enabled || revision !== startedRevision) return raw;
    if (!P.isPlaylist(raw)) {
      diagnostic(details.tabId, { issue: "The stream server returned a response that is not a playlist." });
      status(details.tabId, "error", channel || context?.channel);
      return raw;
    }
    if (channel) {
      if (P.isMaster(raw)) {
        let count = 0;
        const apiVersion = new URL(details.url).pathname.startsWith("/api/v2/") ? 2 : 1;
        for (const variant of P.parseVariants(raw, details.url)) {
          if (P.isTwitchStreamUrl(variant.url)) {
            remember(contexts, contextKey(details, variant.url), { channel, variant, apiVersion, sessionId: details.requestId, updated: Date.now() }, 512);
            count++;
          }
        }
        diagnostic(details.tabId, { channel, variants: count, apiVersion, issue: count ? null : "No supported video playlists were found in the stream response." });
      } else {
        diagnostic(details.tabId, { issue: "The stream response did not contain a video quality list." });
      }
      return raw;
    }
    if (!context || P.isMaster(raw)) return raw;
    const key = contextKey(details);
    // This initial version handles complete, unencrypted Twitch segments.
    // Leave encrypted and byte-range playlists intact to preserve their IVs
    // and implicit byte offsets, and report that filtering was unavailable.
    if (/^#EXT-X-(?:KEY:(?!METHOD=NONE)|BYTERANGE:)/m.test(raw)) {
      diagnostic(details.tabId, { issue: "This stream uses encryption or byte ranges that pUDblock cannot filter." });
      status(details.tabId, "error", context.channel);
      return raw;
    }
    if (!P.containsAds(raw)) {
      await present(details, false, context.channel);
      status(details.tabId, "clean", context.channel);
      return timeline.normalize(key, raw);
    }
    let backup = null;
    let backupInfo = settings.backups ? "Backup search ended without a usable stream." : "Alternate streams are switched off.";
    if (settings.backups) {
      try { backup = await resolverFor(details, context).resolve(context.channel, context.variant, raw, signal, context.apiVersion, info => { backupInfo = info; }); }
      catch { backupInfo = "The backup search failed; no compatible clean stream was selected."; }
    }
    if (!settings.enabled || revision !== startedRevision) return raw;
    diagnostic(details.tabId, { backupInfo, backupAt: Date.now() });
    if (backup) {
      const normalized = timeline.normalize(key, backup.content, { candidate: true });
      if (normalized && P.segmentCount(normalized)) {
        await present(details, false, context.channel);
        status(details.tabId, "backup", context.channel);
        return normalized;
      }
      diagnostic(details.tabId, { backupInfo: ("Clean backup rejected: older than the current playback window. " + backupInfo).slice(0, 700) });
    }
    // Twitch's web player treats an empty/shortened live window as an ended
    // stream. Keep its normal playlist intact; hide/mute at the player layer
    // until a clean backup or primary stream can be loaded again.
    const guarded = await present(details, true, context.channel);
    if (!settings.enabled || revision !== startedRevision) return raw;
    status(details.tabId, "waiting", context.channel);
    if (!guarded) diagnostic(details.tabId, { issue: "Reload this Twitch tab to activate the hidden-ad waiting screen." });
    return timeline.normalize(key, raw);
  }

  function attachFilter(details, channel, context) {
    const filter = browser.webRequest.filterResponseData(details.requestId);
    const chunks = [];
    let bytes = 0;
    let finished = false;
    const controller = new AbortController();
    const startedRevision = revision;
    const release = () => { clearTimeout(watchdog); active.delete(details.requestId); controller.abort(); };
    const passThrough = reason => {
      if (finished) return;
      if (reason) {
        diagnostic(details.tabId, { issue: reason });
        status(details.tabId, "error", channel || context?.channel);
      }
      finished = true;
      release();
      try { for (const chunk of chunks) filter.write(chunk); filter.disconnect(); } catch { /* The player may have cancelled. */ }
    };
    const watchdog = setTimeout(() => passThrough("A playlist response timed out; original playback was kept."), 15000);
    active.set(details.requestId, { passThrough, controller });
    filter.ondata = event => {
      if (finished) return;
      chunks.push(event.data); bytes += event.data.byteLength;
      if (bytes > 1024 * 1024) passThrough("A playlist response exceeded the size limit; original playback was kept.");
    };
    filter.onstop = async () => {
      if (finished) return;
      clearTimeout(watchdog);
      const data = new Uint8Array(bytes);
      let offset = 0;
      for (const chunk of chunks) { data.set(new Uint8Array(chunk), offset); offset += chunk.byteLength; }
      const raw = new TextDecoder().decode(data);
      // A shared hard deadline bounds the entire alternate-player search.
      const deadline = setTimeout(() => controller.abort("backup-timeout"), 4000);
      let output = raw;
      try { output = await transform(details, raw, channel, context, controller.signal, startedRevision); }
      catch {
        diagnostic(details.tabId, { issue: "A playlist could not be processed; original playback was kept." });
        status(details.tabId, "error", channel || context?.channel);
      }
      finally { clearTimeout(deadline); }
      if (finished) return;
      finished = true;
      release();
      try {
        // Keep non-HLS bodies byte-for-byte, including binary error responses.
        filter.write(output === raw ? data : new TextEncoder().encode(output));
        filter.close();
      } catch { /* Closing or navigating the tab cancels its requests. */ }
    };
    filter.onerror = () => {
      if (finished) return;
      diagnostic(details.tabId, { issue: "Firefox could not read a playlist response. Reload the stream to try again." });
      status(details.tabId, "error", channel || context?.channel);
      finished = true; release();
      try { filter.disconnect(); } catch { /* Already disconnected. */ }
    };
  }

  async function onBeforeRequest(details) {
    await ready;
    if (!settings.enabled) return {};
    // Our anonymous backup fetches must never recursively filter themselves.
    const origin = details.originUrl || details.documentUrl || "";
    if (origin.startsWith(extensionRoot) || details.tabId < 0 || isPageBackup(details)) return {};
    const channel = identifyMaster(details);
    const observed = diagnostic(details.tabId);
    observed.requests++;
    observed.lastRequest = Date.now();
    if (channel) {
      if (observed.channel !== channel) { observed.backupInfo = null; observed.backupAt = null; }
      observed.masters++; observed.channel = channel;
    }
    const context = contexts.get(contextKey(details));
    if (!channel && (!context || Date.now() - context.updated > 6 * 60 * 60 * 1000)) return {};
    try { attachFilter(details, channel, context); }
    catch {
      diagnostic(details.tabId, { issue: "Firefox could not attach the playlist filter. Reload the add-on and stream." });
      status(details.tabId, "error", channel || context?.channel);
    }
    return {};
  }

  browser.webRequest.onBeforeRequest.addListener(onBeforeRequest, { urls: ["https://*.ttvnw.net/*.m3u8*"] }, ["blocking"]);
  browser.webRequest.onHeadersReceived.addListener(details => {
    if (!active.has(details.requestId)) return {};
    const headers = (details.responseHeaders || []).filter(header => !["content-length", "etag", "content-md5", "cache-control"].includes(header.name.toLowerCase()));
    headers.push({ name: "Cache-Control", value: "no-store" });
    return { responseHeaders: headers };
  }, { urls: ["https://*.ttvnw.net/*.m3u8*"] }, ["blocking", "responseHeaders"]);

  browser.webRequest.onErrorOccurred.addListener(details => {
    active.get(details.requestId)?.passThrough("A stream request failed before it could be checked.");
  }, { urls: ["https://*.ttvnw.net/*.m3u8*"] });

  async function applySettings(changes) {
    for (const key of Object.keys(settings)) if (typeof changes[key] === "boolean") settings[key] = changes[key];
    revision++;
    for (const item of active.values()) item.passThrough();
    timeline.clear();
    for (const resolver of resolvers.values()) resolver.clear();
    resolvers.clear(); pageRequests.clear(); statuses.clear(); diagnostics.clear();
    await browser.storage.local.set(settings);
    const tabs = await browser.tabs.query({});
    await Promise.all(tabs.map(async tab => {
      await browser.browserAction.setBadgeText({ tabId: tab.id, text: settings.enabled ? "" : "OFF" }).catch(() => {});
      if (!settings.enabled) await browser.tabs.sendMessage(tab.id, { type: "pudblock-player", waiting: false, reset: true }).catch(() => {});
    }));
  }

  browser.runtime.onMessage.addListener(async (message, sender) => {
    if (sender.id !== browser.runtime.id || !sender.url?.startsWith(extensionRoot)) return undefined;
    await ready;
    if (message?.type === "settings") await applySettings(message.changes || {});
    if (message?.type === "status" || message?.type === "settings") {
      return { settings: { ...settings }, status: statuses.get(message.tabId) || null, diagnostics: diagnostics.get(message.tabId) || null, version: browser.runtime.getManifest().version };
    }
    return undefined;
  });
  browser.tabs.onRemoved.addListener(tabId => {
    statuses.delete(tabId);
    diagnostics.delete(tabId);
    for (const key of contexts.keys()) if (key.startsWith(`${tabId}|`)) contexts.delete(key);
    for (const key of resolvers.keys()) if (key.startsWith(`${tabId}|`)) resolvers.delete(key);
    for (const key of pageRequests.keys()) if (key.startsWith(`${tabId}|`)) pageRequests.delete(key);
  });
})();
