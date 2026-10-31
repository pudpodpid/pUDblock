/* Copyright (c) 2026 pudpodpid. MIT licensed; see LICENSE.
 * Player reset uses the integration approach credited to TwitchAdSolutions.
 * No Twitch credentials or media URLs enter this presentation-only module.
 */
function installPudblockPlayerGuard(scope) {
  "use strict";
  const doc = scope.document;
  let phase = "idle";
  let route;
  let overlay;
  let timer;
  let observer;
  let resetTried = false;
  let releasingSince = 0;
  let generation = 0;
  let originalMuted;
  let lastReset = 0;
  const videos = new Map();
  const positions = new Map();
  const roots = new Map();
  const edge = video => video.buffered.length ? video.buffered.end(video.buffered.length - 1) : 0;

  function restore() {
    generation++;
    phase = "idle";
    clearInterval(timer); timer = undefined;
    observer?.disconnect(); observer = undefined;
    overlay?.remove(); overlay = undefined;
    for (const [video, saved] of videos) {
      video.style.setProperty("visibility", saved.visibility, saved.priority);
      video.removeEventListener("volumechange", saved.remute);
      video.removeEventListener("emptied", saved.emptied);
      video.muted = saved.muted;
    }
    for (const [root, saved] of roots) root.style.setProperty("position", saved.value, saved.priority);
    roots.clear();
    videos.clear(); positions.clear(); originalMuted = undefined;
  }
  function mask() {
    if (phase === "idle") return;
    const players = [...doc.querySelectorAll('[data-a-target="video-player"] video, .video-player video')];
    if (!players.length && doc.querySelector("video")) players.push(doc.querySelector("video"));
    for (const video of players) {
      if (!videos.has(video)) {
        originalMuted ??= video.muted;
        const remute = () => { if (phase !== "idle" && !video.muted) video.muted = true; };
        const emptied = () => { if (phase === "recovering") positions.set(video, { baseline: 0 }); };
        videos.set(video, { muted: originalMuted, visibility: video.style.getPropertyValue("visibility"), priority: video.style.getPropertyPriority("visibility"), remute, emptied });
        video.addEventListener("volumechange", remute);
        video.addEventListener("emptied", emptied);
        if (phase === "recovering") positions.set(video, { baseline: 0 });
      }
      video.muted = true;
      video.style.setProperty("visibility", "hidden", "important");
    }
    const video = [...videos.keys()].find(item => item.isConnected);
    const root = video?.closest('[data-a-target="video-player"], .video-player') || video?.parentElement;
    if (root && !overlay?.isConnected) {
      if (scope.getComputedStyle(root).position === "static" && !roots.has(root)) {
        roots.set(root, { value: root.style.getPropertyValue("position"), priority: root.style.getPropertyPriority("position") });
        root.style.position = "relative";
      }
      overlay?.remove();
      overlay = doc.createElement("div");
      overlay.dataset.pudblockWaiting = "true";
      overlay.setAttribute("role", "status");
      // Avoid changing the page layout or covering chat and navigation.
      Object.assign(overlay.style, { position: "absolute", inset: "0", zIndex: "100", display: "grid", placeContent: "center", padding: "24px", textAlign: "center", background: "#111b1c", color: "#e6efec", font: "16px/1.6 system-ui,sans-serif", pointerEvents: "none" });
      root.appendChild(overlay);
    }
    const message = phase === "recovering" ? (Date.now() - releasingSince > 20000 ? "pUDblock · Clean content detected; waiting for the player. Try its reload control if playback stays stopped." : "pUDblock · Returning to the live stream…") : "pUDblock · Waiting for a clean stream. Ads are hidden and muted.";
    if (overlay && overlay.textContent !== message) overlay.textContent = message;
  }
  function resetPlayer() {
    // Twitch owns this private API; fall back to the standard media seek if it
    // changes. Only one reset is allowed per fallback, after clean video exists.
    if (resetTried) return false;
    resetTried = true;
    if (Date.now() - lastReset < 15000) return false;
    try {
      const root = doc.querySelector("#root");
      const key = root && Object.keys(root).find(name => name.startsWith("__reactContainer"));
      const start = root?._reactRootContainer?._internalRoot?.current || (key && root[key]);
      if (!start) return false;
      const stack = [start];
      const seen = new Set();
      while (stack.length && seen.size < 6000) {
        const node = stack.pop();
        if (!node || seen.has(node)) continue;
        seen.add(node);
        const state = node.stateNode;
        if (typeof state?.setSrc === "function" && typeof state.setInitialPlaybackSettings === "function") {
          lastReset = Date.now();
          state.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
          return true;
        }
        stack.push(node.child, node.sibling, node.alternate);
      }
    } catch { /* The standard video seek below remains available. */ }
    return false;
  }
  function tick() {
    if (phase === "idle") return;
    if (scope.location.pathname !== route) { restore(); return; }
    mask();
    if (phase !== "recovering") return;
    const currentGeneration = generation;
    for (const [video, position] of positions) {
      if (!video.isConnected || position.seeking) continue;
      const end = edge(video);
      // A clean response has not been consumed by the player when we receive
      // its notification. Wait for newly buffered media before seeking/unmuting.
      if (end <= position.baseline + 0.05 || !video.seekable.length) continue;
      const target = Math.min(end, video.seekable.end(video.seekable.length - 1)) - 0.1;
      if (target <= video.buffered.start(video.buffered.length - 1)) continue;
      position.seeking = true;
      const finish = () => {
        if (phase !== "recovering" || currentGeneration !== generation || video.seeking || video.currentTime < target - 0.2) return;
        if (typeof video.requestVideoFrameCallback === "function") video.requestVideoFrameCallback(() => {
          if (phase === "recovering" && currentGeneration === generation) restore();
        });
        else restore();
      };
      video.addEventListener("seeked", finish, { once: true });
      try { video.currentTime = target; } catch { position.seeking = false; }
    }
    if (!resetTried && Date.now() - releasingSince > 5000) resetPlayer();
  }
  function update(waiting, channel) {
    if (channel && /(^|\.)twitch\.tv$/i.test(scope.location.hostname)) {
      const path = /^\/(?:popout\/|embed\/)?([a-z0-9_]+)(?:\/|$)/i.exec(scope.location.pathname)?.[1];
      const active = new URL(scope.location.href).searchParams.get("channel") || path;
      if (active && active.toLowerCase() !== channel.toLowerCase()) return { ok: true, ignored: true };
    }
    if (waiting) {
      if (phase !== "waiting") {
        generation++;
        phase = "waiting";
        route = scope.location.pathname;
        positions.clear(); resetTried = false;
      }
      mask();
      if (!timer) timer = setInterval(tick, 200);
      if (!observer && doc.documentElement) {
        observer = new MutationObserver(() => mask());
        observer.observe(doc.documentElement, { childList: true, subtree: true });
      }
    } else if (phase === "waiting") {
      generation++;
      phase = "recovering";
      releasingSince = Date.now();
      for (const video of videos.keys()) positions.set(video, { baseline: edge(video) });
      // Reset the player once to discard buffered ads. No page reload loop.
      resetPlayer();
      mask();
    }
    return { ok: true };
  }
  scope.addEventListener("pagehide", restore);
  return { update, reset: restore };
}
globalThis.PudblockInstallPlayerGuard = installPudblockPlayerGuard;
