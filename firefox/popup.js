/* global browser */
"use strict";
let tabId;
let saving = false;
const $ = id => document.getElementById(id);

async function refresh(changes) {
  const response = await browser.runtime.sendMessage({ type: changes ? "settings" : "status", tabId, changes });
  const { settings, status, diagnostics, version } = response;
  $("enabled").checked = settings.enabled;
  $("backups").checked = settings.backups;
  $("backups").disabled = !settings.enabled;
  $("filtered").textContent = String(status?.filtered || 0);
  $("alternate").textContent = String(status?.backups || 0);
  $("checked").textContent = String(status?.checked || 0);
  const state = globalThis.StreamFilterUI.describe(response);
  $("state").textContent = state.label;
  $("detail").textContent = state.detail;
  $("dot").className = `dot${state.tone ? " " + state.tone : ""}`;
  $("last-check").textContent = status?.checked ? `Last checked ${Math.max(0, Math.floor((Date.now() - status.lastChecked) / 1000))}s ago` : "No playlists checked yet";
  $("diagnostics").textContent = `${diagnostics?.requests || 0} playlist requests seen · ${diagnostics?.masters || 0} stream requests · ${diagnostics?.variants || 0} linked video qualities${diagnostics?.apiVersion ? " · Twitch API v" + diagnostics.apiVersion : ""}.`;
  $("backup-diagnostics").hidden = !diagnostics?.backupInfo;
  $("backup-diagnostics").textContent = diagnostics?.backupInfo ? `Last backup search (${Math.max(0, Math.floor((Date.now() - diagnostics.backupAt) / 1000))}s ago): ${diagnostics.backupInfo}` : "";
  $("version").textContent = `v${version}`;
}
function showError(error) { $("error").hidden = false; $("error").textContent = error.message || "Unable to update the extension."; }
for (const name of ["enabled", "backups"]) {
  $(name).addEventListener("change", async () => {
    saving = true;
    $("enabled").disabled = true; $("backups").disabled = true;
    try { await refresh({ [name]: $(name).checked }); }
    catch (error) { showError(error); }
    finally { $("enabled").disabled = false; $("backups").disabled = !$("enabled").checked; saving = false; }
  });
}
for (const counter of document.querySelectorAll(".counter")) {
  const resetHint = () => counter.classList.remove("tooltip-dismissed");
  counter.addEventListener("mouseenter", resetHint);
  counter.addEventListener("focus", resetHint);
}
document.addEventListener("keydown", event => {
  if (event.key === "Escape") {
    for (const counter of document.querySelectorAll(".counter")) counter.classList.add("tooltip-dismissed");
  }
});
(async () => {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  tabId = tab?.id;
  await refresh();
  setInterval(() => { if (!saving) refresh().catch(showError); }, 1500);
})().catch(showError);
