/* global chrome */
/* Copyright (c) 2026 pudpodpid. MIT licensed; see LICENSE. */
"use strict";

const extensionRoot = chrome.runtime.getURL("");
let settings = { enabled: true, backups: true };
const tabStates = new Map();
const ready = Promise.all([
  chrome.storage.local.get(["enabled", "backups"]),
  chrome.storage.session.get("tabStates")
]).then(([saved, session]) => {
  for (const key of Object.keys(settings)) if (typeof saved[key] === "boolean") settings[key] = saved[key];
  for (const [key, value] of Object.entries(session.tabStates || {})) tabStates.set(Number(key), value);
}).catch(() => {});
let serial = ready;
function enqueue(operation) {
  const result = serial.then(operation);
  serial = result.catch(() => {});
  return result;
}
function stateFor(tabId) {
  let value = tabStates.get(tabId);
  if (!value) {
    value = { status: null, diagnostics: { requests: 0, masters: 0, variants: 0, channel: null, issue: null } };
    tabStates.set(tabId, value);
    while (tabStates.size > 128) tabStates.delete(tabStates.keys().next().value);
  }
  return value;
}
function persist() { return chrome.storage.session.set({ tabStates: Object.fromEntries(tabStates) }); }
function isTwitchPage(sender) {
  try {
    const url = new URL(sender.url);
    return sender.tab?.id >= 0 && url.protocol === "https:" && (url.hostname === "twitch.tv" || url.hostname.endsWith(".twitch.tv"));
  } catch { return false; }
}
async function badge(tabId, result) {
  const text = { clean: "ON", backup: "ALT", filtered: "CUT", waiting: "WAIT", error: "!", off: "OFF" }[result] || "";
  const color = result === "error" ? "#bd4e56" : ["filtered", "waiting"].includes(result) ? "#9c6b24" : "#236e5b";
  await Promise.all([
    chrome.action.setBadgeText({ tabId, text }).catch(() => {}),
    chrome.action.setBadgeBackgroundColor({ tabId, color }).catch(() => {})
  ]);
}
async function recordEvents(tabId, events) {
  if (!settings.enabled) return;
  const value = stateFor(tabId);
  for (const event of events.slice(0, 64)) {
    if (!event || !["master", "result", "issue", "backup-info"].includes(event.kind)) continue;
    const channel = /^[a-z0-9_]{1,40}$/i.test(event.channel || "") ? event.channel.toLowerCase() : value.diagnostics.channel;
    if (channel) {
      if (value.diagnostics.channel !== channel) { value.diagnostics.backupInfo = null; value.diagnostics.backupAt = null; }
      value.diagnostics.channel = channel;
    }
    if (event.kind === "backup-info") {
      if (typeof event.info === "string") {
        value.diagnostics.backupInfo = event.info.slice(0, 700);
        value.diagnostics.backupAt = Date.now();
      }
      continue;
    }
    if (event.kind === "master") {
      value.diagnostics.processedMasters = (value.diagnostics.processedMasters || 0) + 1;
      value.diagnostics.masters = Math.max(value.diagnostics.observedMasters || 0, value.diagnostics.processedMasters);
      value.diagnostics.variants = Number.isInteger(event.variants) ? Math.max(0, Math.min(64, event.variants)) : 0;
      if ([1, 2].includes(event.apiVersion)) value.diagnostics.apiVersion = event.apiVersion;
      value.diagnostics.issue = value.diagnostics.variants ? null : "No supported video playlists were found in the stream response.";
      continue;
    }
    if (event.kind === "issue") {
      value.diagnostics.issue = typeof event.issue === "string" ? event.issue.slice(0, 240) : "The playback hook could not process a playlist.";
      await badge(tabId, "error");
      continue;
    }
    if (!["clean", "backup", "filtered", "waiting"].includes(event.result)) continue;
    const status = value.status?.channel === channel ? value.status : { channel, checked: 0, filtered: 0, backups: 0 };
    status.checked++;
    if (["filtered", "waiting"].includes(event.result)) status.filtered++;
    if (event.result === "backup") status.backups++;
    status.result = event.result;
    status.lastSeen = status.lastChecked = Date.now();
    value.status = status;
    value.diagnostics.issue = null;
    await badge(tabId, event.result);
  }
  await persist();
}
async function applySettings(changes) {
  for (const key of Object.keys(settings)) if (typeof changes[key] === "boolean") settings[key] = changes[key];
  await chrome.storage.local.set(settings);
  tabStates.clear(); await persist();
  const tabs = await chrome.tabs.query({});
  await Promise.all(tabs.map(async tab => {
    await badge(tab.id, settings.enabled ? "" : "off");
    await chrome.tabs.sendMessage(tab.id, { type: "config", settings }).catch(() => {});
  }));
}
async function message(message, sender) {
  if (sender.id !== chrome.runtime.id) return undefined;
  const extensionPage = sender.url?.startsWith(extensionRoot);
  if (message?.type === "configure" && isTwitchPage(sender)) return { settings: { ...settings } };
  if (message?.type === "stream-events" && isTwitchPage(sender) && Array.isArray(message.events)) {
    await recordEvents(sender.tab.id, message.events);
    return { ok: true };
  }
  if (!extensionPage) return undefined;
  if (message?.type === "settings") await applySettings(message.changes || {});
  if (["status", "settings"].includes(message?.type)) {
    const value = tabStates.get(message.tabId);
    return { settings: { ...settings }, status: value?.status || null, diagnostics: value?.diagnostics || null, version: chrome.runtime.getManifest().version };
  }
  return undefined;
}
chrome.runtime.onMessage.addListener((value, sender, respond) => {
  enqueue(() => message(value, sender)).then(respond, () => respond(undefined));
  return true;
});

// Observation only: the content/worker adapter modifies playlist bodies.
// Chrome MV3 does not grant ordinary extensions webRequestBlocking.
chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.tabId < 0 || details.initiator?.startsWith(extensionRoot)) return;
  enqueue(async () => {
    if (!settings.enabled) return;
    const value = stateFor(details.tabId);
    value.diagnostics.requests++;
    value.diagnostics.lastRequest = Date.now();
    const url = new URL(details.url);
    const channel = url.hostname === "usher.ttvnw.net" ? /^\/api\/(?:v2\/)?channel\/hls\/([a-z0-9_]+)\.m3u8$/i.exec(url.pathname)?.[1]?.toLowerCase() : null;
    if (channel) {
      if (value.diagnostics.channel !== channel) { value.diagnostics.backupInfo = null; value.diagnostics.backupAt = null; }
      value.diagnostics.observedMasters = (value.diagnostics.observedMasters || 0) + 1;
      value.diagnostics.masters = Math.max(value.diagnostics.observedMasters, value.diagnostics.processedMasters || 0);
      value.diagnostics.channel = channel;
    }
    await persist();
  }).catch(() => {});
}, { urls: ["https://*.ttvnw.net/*.m3u8*"] });
chrome.tabs.onRemoved.addListener(tabId => {
  enqueue(async () => { tabStates.delete(tabId); await persist(); }).catch(() => {});
});
