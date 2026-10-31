/* Copyright (c) 2026 pudpodpid. MIT licensed; see LICENSE.
 * MAIN-world Firefox backup transport. Like Chrome's adapter, requests use
 * Twitch's page origin and native fetch with credentials omitted.
 */
(() => {
  "use strict";
  const KEY = Symbol.for("pudblock.pageTransport.v1");
  if (window[KEY]) return;
  window[KEY] = true;
  const P = globalThis.StreamFilterCore;
  const nativeFetch = window.fetch.bind(window);
  const pending = new Map();
  const post = (id, value) => window.postMessage({ source: "pudblock-backup-response-v1", id, ...value }, location.origin);
  function build(request) {
    if (request?.kind === "token") return P.playbackTokenRequest(request.channel, request.playerType);
    if (request?.kind !== "playlist" || typeof request.url !== "string" || request.url.length > 32768) throw new Error("Invalid request");
    const url = new URL(request.url);
    if (!P.isTwitchStreamUrl(url.href) || !url.pathname.endsWith(".m3u8") || url.username || url.password || url.hash) throw new Error("Invalid request");
    return { url: url.href, init: { method: "GET" } };
  }
  async function read(response) {
    if (!response.ok) return "";
    const reader = response.body?.getReader();
    if (!reader) return "";
    const decoder = new TextDecoder();
    let bytes = 0;
    let text = "";
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) throw new Error("Response too large");
        text += decoder.decode(value, { stream: true });
      }
      return text + decoder.decode();
    } finally { reader.cancel().catch(() => {}); }
  }
  window.addEventListener("message", async event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "pudblock-backup-control-v1") return;
    const { id, action, request } = event.data;
    if (typeof id !== "string" || !/^[a-f\d-]{36}$/i.test(id)) return;
    if (action === "cancel") { pending.get(id)?.abort(); return; }
    if (action !== "request" || pending.has(id)) return;
    if (pending.size >= 16) { post(id, { error: "busy" }); return; }
    let operation;
    try { operation = build(request); } catch { post(id, { error: "invalid" }); return; }
    const controller = new AbortController();
    pending.set(id, controller);
    let timedOut = false;
    const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, 4500);
    try {
      const response = await nativeFetch(operation.url, { ...operation.init, credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal });
      const body = await read(response);
      post(id, { status: response.status, body });
    } catch {
      post(id, { error: timedOut ? "timeout" : controller.signal.aborted ? "cancelled" : "network" });
    } finally { clearTimeout(timeout); pending.delete(id); }
  });
  window.addEventListener("pagehide", () => { for (const controller of pending.values()) controller.abort(); pending.clear(); });
})();
