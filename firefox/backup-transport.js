/* Copyright (c) 2026 pudpodpid. MIT licensed; see LICENSE.
 * Firefox background adapter. The page performs only fixed anonymous token
 * requests and allowlisted HLS requests; it receives no extension fetch API.
 */
(() => {
  "use strict";
  const P = globalThis.StreamFilterCore;
  const error = (reason, name = "Error") => Object.assign(new Error("Twitch page request failed"), { reason, name });
  function descriptor(input, init) {
    const url = new URL(input);
    if (url.href === "https://gql.twitch.tv/gql" && init.method === "POST") {
      const body = JSON.parse(init.body);
      if (body.operationName !== "PlaybackAccessToken_Template") throw error("page-transport");
      const { login: channel, playerType } = body.variables || {};
      P.playbackTokenRequest(channel, playerType); // Validate the fixed request.
      return { kind: "token", channel, playerType };
    }
    if (!P.isTwitchStreamUrl(url.href) || !url.pathname.endsWith(".m3u8") || url.username || url.password || url.hash || url.href.length > 32768 || (init.method && init.method !== "GET")) throw error("page-transport");
    return { kind: "playlist", url: url.href };
  }
  function createPageFetcher(api, tabId, frameId, observe = {}) {
    const send = message => api.tabs.sendMessage(tabId, message, { frameId });
    return function fetchFromPage(input, init = {}) {
      let request;
      try { request = descriptor(input, init); } catch { return Promise.reject(error("page-transport")); }
      if (init.signal?.aborted) return Promise.reject(error("page-timeout", "AbortError"));
      const id = crypto.randomUUID();
      return new Promise((resolve, reject) => {
        let settled = false;
        let timer;
        const done = (failure, value) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          init.signal?.removeEventListener("abort", abort);
          if (request.kind === "playlist") observe.end?.(request.url);
          failure ? reject(failure) : resolve(value);
        };
        const cancel = () => { try { Promise.resolve(send({ type: "pudblock-backup-cancel", id })).catch(() => {}); } catch { /* A closed frame cannot receive cancellation. */ } };
        const abort = () => { cancel(); done(error("page-timeout", "AbortError")); };
        init.signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { cancel(); done(error("page-timeout")); }, 4500);
        if (request.kind === "playlist") observe.start?.(request.url);
        try {
          Promise.resolve(send({ type: "pudblock-backup-request", id, request })).then(reply => {
            if (settled) return;
            if (!reply || reply.error) {
              const reasons = { network: "network", timeout: "page-timeout", unavailable: "page-transport", invalid: "page-response", busy: "page-busy", cancelled: "page-timeout" };
              done(error(reasons[reply?.error] || "page-transport"));
              return;
            }
            if (!Number.isInteger(reply.status) || reply.status < 100 || reply.status > 599 || typeof reply.body !== "string" || reply.body.length > 1024 * 1024) { done(error("page-response")); return; }
            done(null, { ok: reply.status >= 200 && reply.status < 300, status: reply.status, text: async () => reply.body });
          }, () => done(error("page-transport")));
        } catch { done(error("page-transport")); }
      });
    };
  }
  globalThis.PudblockCreatePageFetcher = createPageFetcher;
})();
