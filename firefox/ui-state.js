"use strict";
(() => {
  const labels = { clean: "Checking live stream", backup: "Using a clean alternate", filtered: "Ad segments removed", waiting: "Ads hidden and muted", error: "Filtering unavailable" };
  function describe({ settings, status, diagnostics }, now = Date.now()) {
    if (!settings.enabled) return { label: "Filtering is off", detail: "Turn filtering on to resume.", tone: "" };
    if (diagnostics?.issue) return { label: "Filtering unavailable", detail: diagnostics.issue, tone: "wait" };
    if (status && now - status.lastSeen < 20000) {
      const detail = status.result === "clean" ? "No ad markers in the latest playlist." : status.result === "waiting" ? "Waiting for clean video; the player continues underneath." : status.result === "error" ? "Original playback was kept." : "Ad filtering is active on this stream.";
      return { label: labels[status.result] || "Stream detected", detail: `${status.channel || "Live stream"} · ${detail}`, tone: ["clean", "backup"].includes(status.result) ? "active" : "wait" };
    }
    if (status?.checked) return { label: "No recent playlist activity", detail: "Checks have stopped. The stream may be paused, offline or disconnected.", tone: "wait" };
    if (diagnostics?.variants) return { label: "Stream detected", detail: `${diagnostics.channel} · waiting for its first video playlist.`, tone: "" };
    if (diagnostics?.masters) return { label: "Waiting for stream response", detail: `${diagnostics.channel} · a stream request was seen; no video playlists are linked yet.`, tone: "" };
    if (diagnostics?.requests) return { label: "Video requests are not linked", detail: "Video requests were seen, but the live stream was not identified. Reload this tab.", tone: "wait" };
    return { label: "No stream requests detected", detail: "Start a Twitch live stream or reload this tab. Checks should appear even without ads.", tone: "" };
  }
  globalThis.StreamFilterUI = Object.freeze({ describe });
})();
