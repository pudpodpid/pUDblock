/* Copyright (c) 2026 pudpodpid. MIT licensed; see LICENSE. */
(() => {
  "use strict";
  const guard = globalThis.PudblockInstallPlayerGuard(window);
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== "pudblock-player-control-v1") return;
    const { id, waiting, reset, channel } = event.data;
    if (typeof id !== "string" || id.length > 80 || typeof waiting !== "boolean") return;
    reset ? guard.reset() : guard.update(waiting, typeof channel === "string" ? channel : undefined);
    window.postMessage({ source: "pudblock-player-applied-v1", id }, location.origin);
  });
})();
