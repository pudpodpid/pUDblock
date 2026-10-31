/* Copyright (c) 2026 pudpodpid. MIT licensed; see LICENSE. */
(() => {
  "use strict";
  const KEY = Symbol.for("pudblock.pageHook.v1");
  if (window[KEY]) return;
  window[KEY] = true;
  const SOURCE = "pudblock-page-v1";
  const CONTROL = "pudblock-extension-v1";
  const token = crypto.randomUUID();
  const workers = new Set();
  const blobs = new Map();
  const contextCache = new Map();
  let blobBytes = 0;
  let settings = { enabled: false, backups: true, initialized: false };
  const nativeCreate = URL.createObjectURL.bind(URL);
  const nativeRevoke = URL.revokeObjectURL.bind(URL);
  const NativeWorker = window.Worker;
  const post = (type, value) => window.postMessage({ source: SOURCE, type, value }, location.origin);
  const guard = globalThis.PudblockInstallPlayerGuard(window);
  const report = value => {
    if (value.kind === "result") guard.update(value.result === "waiting", value.channel);
    post("event", value);
  };
  function send(worker, type, value) { worker.postMessage({ pudblock: token, type, value }); }
  function distribute(entries, sender) {
    for (const entry of entries) {
      contextCache.delete(entry.variant.url); contextCache.set(entry.variant.url, entry);
    }
    while (contextCache.size > 512) contextCache.delete(contextCache.keys().next().value);
    runtime.learnContexts(entries);
    for (const worker of workers) if (worker !== sender) send(worker, "contexts", entries);
  }
  const runtime = globalThis.PudblockInstallRuntime(window, settings, entries => distribute(entries), report);

  // Remember the actual Blob so a site can revoke its URL immediately after
  // construction, exactly as it can with a native Worker. No synchronous XHR,
  // eval, new Function or third-party script download is used by this adapter.
  URL.createObjectURL = function createObjectURL(blob) {
    const url = nativeCreate(blob);
    if (blob instanceof Blob && blob.size <= 8 * 1024 * 1024 && (!blob.type || /(?:java|ecma)script/i.test(blob.type))) {
      blobs.set(url, blob);
      blobBytes += blob.size;
      while (blobs.size > 32 || blobBytes > 16 * 1024 * 1024) {
        const oldest = blobs.keys().next().value;
        blobBytes -= blobs.get(oldest).size; blobs.delete(oldest);
      }
    }
    return url;
  };
  URL.revokeObjectURL = function revokeObjectURL(url) {
    const key = String(url);
    if (blobs.has(key)) { blobBytes -= blobs.get(key).size; blobs.delete(key); }
    nativeRevoke(url);
  };

  class PudblockWorker extends NativeWorker {
    constructor(input, options) {
      if (settings.initialized && !settings.enabled) { super(input, options); return; }
      const originalUrl = new URL(String(input), location.href);
      const sourceBlob = blobs.get(originalUrl.href);
      const eligible = originalUrl.origin === location.origin && (sourceBlob || originalUrl.protocol === "https:" || originalUrl.protocol === "http:");
      if (!eligible) {
        super(input, options);
        report({ kind: "issue", issue: "A playback worker could not be hooked. Reload the Twitch tab to retry." });
        return;
      }
      const prefix = `(() => {
        const token = ${JSON.stringify(token)};
        const installCore = ${globalThis.PudblockInstallCore.toString()};
        installCore();
        const installRuntime = ${globalThis.PudblockInstallRuntime.toString()};
        const acknowledgements = new Map();
        let nextAck = 0;
        const runtime = installRuntime(self, ${JSON.stringify(settings)},
          value => self.postMessage({pudblock: token, type: 'contexts', value}),
          value => {
            if (value.kind !== 'result' || value.result !== 'waiting') { self.postMessage({pudblock: token, type: 'event', value}); return; }
            return new Promise(resolve => {
              const ack = ++nextAck;
              const timer = setTimeout(() => { acknowledgements.delete(ack); resolve(); }, 1000);
              acknowledgements.set(ack, () => { clearTimeout(timer); resolve(); });
              self.postMessage({pudblock: token, type: 'event', value, ack});
            });
          });
        self.addEventListener('message', event => {
          if (event.data?.pudblock !== token) return;
          event.stopImmediatePropagation();
          if (event.data.type === 'config') runtime.updateSettings(event.data.value);
          if (event.data.type === 'contexts') runtime.learnContexts(event.data.value);
          if (event.data.type === 'guarded') { acknowledgements.get(event.data.value)?.(); acknowledgements.delete(event.data.value); }
        });
      })();\n`;
      // A captured Blob is appended verbatim after our local bootstrap. For a
      // normal same-origin script, retain its native URL as the import base.
      const original = sourceBlob || (options?.type === "module" ? `await import(${JSON.stringify(originalUrl.href)});` : `importScripts(${JSON.stringify(originalUrl.href)});`);
      const suffix = `\n;self.postMessage({pudblock:${JSON.stringify(token)},type:'booted'});\n`;
      const blobUrl = nativeCreate(new Blob([prefix, original, suffix], { type: "text/javascript" }));
      try { super(blobUrl, options); }
      catch (error) { nativeRevoke(blobUrl); throw error; }
      workers.add(this);
      const cleanupTimer = setTimeout(() => nativeRevoke(blobUrl), 30000);
      this.addEventListener("message", event => {
        if (event.data?.pudblock !== token) return;
        event.stopImmediatePropagation();
        if (event.data.type === "booted") { clearTimeout(cleanupTimer); nativeRevoke(blobUrl); }
        if (event.data.type === "contexts") distribute(event.data.value, this);
        if (event.data.type === "event") {
          report(event.data.value);
          if (Number.isInteger(event.data.ack)) send(this, "guarded", event.data.ack);
        }
      });
      this.addEventListener("error", () => {
        clearTimeout(cleanupTimer); nativeRevoke(blobUrl); workers.delete(this);
        report({ kind: "issue", issue: "The playback worker reported an error. Reload the Twitch tab to retry." });
      });
      const terminate = this.terminate.bind(this);
      this.terminate = () => { clearTimeout(cleanupTimer); nativeRevoke(blobUrl); workers.delete(this); terminate(); };
      if (settings.initialized) send(this, "config", settings);
      if (contextCache.size) send(this, "contexts", [...contextCache.values()]);
    }
  }
  window.Worker = PudblockWorker;
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== CONTROL || event.data.type !== "config") return;
    const config = event.data.value;
    if (typeof config?.enabled !== "boolean" || typeof config?.backups !== "boolean") return;
    settings = { enabled: config.enabled, backups: config.backups, initialized: true };
    runtime.updateSettings(settings);
    if (!settings.enabled) guard.reset();
    for (const worker of workers) send(worker, "config", settings);
  });
  post("hello");
})();
