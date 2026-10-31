import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const config = JSON.parse(await fs.readFile(path.join(root, "release.config.json"), "utf8"));
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
for (const value of [config.supportUrl, config.donationUrl]) {
  if (new URL(value).protocol !== "https:") throw new Error("Public links must use HTTPS");
}
const sections = [
  ["Who publishes pUDblock", [
    `pUDblock is published by ${config.publisher}. Public support/contact profile: ${config.supportUrl}`,
    "pUDblock is an independent browser extension. It is not affiliated with Twitch, Mozilla, Google or the upstream projects credited in CREDITS.md."
  ]],
  ["What the extension processes", [
    "To filter Twitch live-stream ads, pUDblock reads Twitch playlist request URLs, HLS playlist contents, channel names, video quality information and ad markers. It keeps per-tab activity counters and the latest filtering result. Processing is limited to Twitch and its ttvnw.net streaming hosts.",
    "Playback URLs and responses can contain short-lived stream-access tokens. pUDblock handles these in memory to match and request streams. It does not ask for or save your Twitch password, and does not send your account credentials or viewing history to the publisher. Existing Twitch requests and player code continue to run as provided by Twitch.",
    "If no clean backup is available, pUDblock hides and mutes the video while normal playback requests, including ad data, may continue underneath. It reads video buffer/seek state to restore clean playback, keeps the previous mute setting in memory, and can ask Twitch to reset its own player once clean content returns. That reset uses Twitch's normal playback requests. It does not read chat or send player information to the publisher."
  ]],
  ["Network requests and recipients", [
    "Normal playback requests go to Twitch and its streaming CDNs. When the alternate-stream switch is on and an ad is detected, pUDblock may also request an anonymous playback token and alternate playlist directly from Twitch. Those requests identify the Twitch channel being watched and a player type, such as popout or embed.",
    "In both browsers, anonymous backup requests originate from the currently open Twitch page. They omit cookies and do not copy your Twitch account authorization. Firefox uses a bundled page helper for those requests; the website can observe its own page context. Playback tokens and signed backup URLs are handled transiently in the browser and are not sent to the publisher.",
    "Twitch and its CDNs receive the IP address and request information necessary to answer those requests. Their own privacy practices apply. There is no pUDblock relay server, analytics service, advertising tracker or remote log-upload endpoint. No viewing information is sent to the publisher."
  ]],
  ["Local storage and retention", [
    "The filtering and alternate-stream switches are saved in local extension storage. Firefox keeps channel mappings, cached playback URLs and counters in background memory. Chrome keeps channel mappings and cached playback URLs in page/worker memory and stores tab counters in browser session storage so its service worker can restart without losing status.",
    "Caches and tab records are bounded. Tab records are removed when the tab closes. Firefox memory is reset when the add-on or browser restarts; Chrome session records are cleared when the browser session ends or the extension is reloaded or removed. Settings remain until changed or the extension is uninstalled."
  ]],
  ["Your choices", [
    "You can switch filtering off from the popup. You can separately disable alternate streams to stop pUDblock's additional playback-token and backup-playlist requests. Twitch's ordinary website traffic continues independently of the extension.",
    "Uninstalling pUDblock removes its locally saved extension settings. This does not delete data held by Twitch or your browser's own browsing history. Firefox's installation prompt discloses the browsing-activity data sent to Twitch for the alternate-stream feature."
  ]],
  ["Donations and external links", [
    `The optional support link opens ${config.donationUrl}`,
    "Buy Me a Coffee is contacted only if you choose to follow that link. Donations and any payment or account information are handled by that website, under its own terms and privacy policy. pUDblock does not process payments or receive payment-card details. The support profile likewise opens only when you choose its link."
  ]],
  ["No sale, advertising or analytics", [
    "The publisher does not collect, sell, license, share or monetize users' browsing data. Any information pUDblock handles is used only to provide its visible Twitch filtering and status features. Its handling follows the Chrome Web Store User Data Policy, including the Limited Use requirements."
  ]],
  ["Changes and contact", [
    "This policy covers the packaged Firefox and Chrome builds of pUDblock. If a future version changes data handling, the policy and any necessary browser/store disclosures will be updated before that change is released.",
    `Questions about this policy can be directed to ${config.publisher} through the public support/contact profile: ${config.supportUrl}`
  ]]
];
const markdown = `# pUDblock privacy policy\n\nUpdated: ${config.policyUpdated}\n\n` + sections.map(([title, paragraphs]) => `## ${title}\n\n${paragraphs.join("\n\n")}`).join("\n\n") + "\n";
await fs.writeFile(path.join(root, "PRIVACY.md"), markdown);
const escape = value => value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
const paragraph = value => escape(value).replace(/https:\/\/[^\s]+/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Privacy · pUDblock</title><link rel="stylesheet" href="privacy.css"></head>
<body><header><img src="icons/cat-96.png" width="64" height="64" alt=""><div><h1>pUDblock privacy policy</h1><p>Updated ${escape(config.policyUpdated)} · v${escape(pkg.version)}</p></div></header><main>
${sections.map(([title, paragraphs]) => `<section><h2>${escape(title)}</h2>${paragraphs.map(value => `<p>${paragraph(value)}</p>`).join("")}</section>`).join("\n")}
</main><footer>Published by ${escape(config.publisher)} · MIT licensed</footer></body></html>\n`;
await fs.writeFile(path.join(root, "firefox", "privacy.html"), html);
console.log("Generated public PRIVACY.md and the bundled privacy page.");
