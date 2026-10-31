/* global chrome */
/* Copyright (c) 2026 pudpodpid. MIT licensed; see LICENSE. */
(() => {
  "use strict";
  const PAGE = "pudblock-page-v1";
  const CONTROL = "pudblock-extension-v1";
  let settings;
  let pending = [];
  let timer;
  const configure = () => {
    if (settings) window.postMessage({ source: CONTROL, type: "config", value: settings }, location.origin);
  };
  async function refreshSettings() {
    try {
      const response = await chrome.runtime.sendMessage({ type: "configure" });
      settings = response.settings; configure();
    } catch { /* An extension update requires reloading the Twitch tab. */ }
  }
  function flush() {
    clearTimeout(timer); timer = undefined;
    if (!pending.length) return;
    const events = pending; pending = [];
    chrome.runtime.sendMessage({ type: "stream-events", events }).catch(() => {});
  }
  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== PAGE) return;
    if (event.data.type === "hello") { settings ? configure() : refreshSettings(); return; }
    if (event.data.type !== "event") return;
    const value = event.data.value;
    if (!value || !["master", "result", "issue", "backup-info"].includes(value.kind)) return;
    // The MAIN world belongs to the website: messages are untrusted telemetry.
    // This bridge exposes no privileged fetch, scripting or settings commands.
    const clean = { kind: value.kind };
    if (/^[a-z0-9_]{1,40}$/i.test(value.channel || "")) clean.channel = value.channel.toLowerCase();
    if (["clean", "backup", "filtered", "waiting"].includes(value.result)) clean.result = value.result;
    if (typeof value.issue === "string") clean.issue = value.issue.slice(0, 240);
    if (typeof value.info === "string") clean.info = value.info.slice(0, 700);
    if ([1, 2].includes(value.apiVersion)) clean.apiVersion = value.apiVersion;
    if (Number.isInteger(value.variants)) clean.variants = Math.max(0, Math.min(64, value.variants));
    if (pending.length < 64) pending.push(clean);
    if (!timer) timer = setTimeout(flush, 250);
  });
  chrome.runtime.onMessage.addListener(message => {
    if (message?.type !== "config") return;
    settings = message.settings; configure();
  });
  window.addEventListener("pagehide", flush);
  refreshSettings();
})();
