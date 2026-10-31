/* global browser */
/* Copyright (c) 2026 pudpodpid. MIT licensed; see LICENSE. */
(() => {
  "use strict";
  const pending = new Map();
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "pudblock-backup-response-v1") return;
    const finish = pending.get(event.data.id);
    if (!finish) return;
    const value = event.data;
    if (["network", "timeout", "unavailable", "invalid", "busy", "cancelled"].includes(value.error)) finish({ error: value.error });
    else if (Number.isInteger(value.status) && value.status >= 100 && value.status <= 599 && typeof value.body === "string" && value.body.length <= 1024 * 1024) finish({ status: value.status, body: value.body });
    else finish({ error: "invalid" });
  });
  browser.runtime.onMessage.addListener((message, sender) => {
    if (sender.id !== browser.runtime.id) return undefined;
    if (message?.type === "pudblock-backup-cancel") {
      if (pending.has(message.id)) {
        window.postMessage({ source: "pudblock-backup-control-v1", action: "cancel", id: message.id }, location.origin);
        pending.get(message.id)({ error: "cancelled" });
      }
      return Promise.resolve({ ok: true });
    }
    if (message?.type === "pudblock-backup-request") {
      if (typeof message.id !== "string" || !/^[a-f\d-]{36}$/i.test(message.id) || !message.request || pending.has(message.id)) return Promise.resolve({ error: "invalid" });
      if (pending.size >= 16) return Promise.resolve({ error: "busy" });
      return new Promise(resolve => {
        const finish = value => { clearTimeout(timer); pending.delete(message.id); resolve(value); };
        const timer = setTimeout(() => {
          window.postMessage({ source: "pudblock-backup-control-v1", action: "cancel", id: message.id }, location.origin);
          finish({ error: "timeout" });
        }, 4500);
        pending.set(message.id, finish);
        window.postMessage({ source: "pudblock-backup-control-v1", action: "request", id: message.id, request: message.request }, location.origin);
      });
    }
    if (message?.type !== "pudblock-player" || typeof message.waiting !== "boolean") return undefined;
    return new Promise(resolve => {
      const id = crypto.randomUUID();
      const finish = ok => { clearTimeout(timer); window.removeEventListener("message", receive); resolve({ ok }); };
      const receive = event => {
        if (event.source === window && event.origin === location.origin && event.data?.source === "pudblock-player-applied-v1" && event.data.id === id) finish(true);
      };
      const timer = setTimeout(() => finish(false), 500);
      window.addEventListener("message", receive);
      window.postMessage({ source: "pudblock-player-control-v1", id, waiting: message.waiting, reset: message.reset === true, channel: message.channel }, location.origin);
    });
  });
  window.addEventListener("pagehide", () => { for (const finish of [...pending.values()]) finish({ error: "cancelled" }); });
})();
