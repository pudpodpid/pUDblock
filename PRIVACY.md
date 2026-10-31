# pUDblock privacy policy

Updated: 2026-10-31

## Who publishes pUDblock

pUDblock is published by pudpodpid. Public support/contact profile: https://github.com/pudpodpid

pUDblock is an independent browser extension. It is not affiliated with Twitch, Mozilla, Google or the upstream projects credited in CREDITS.md.

## What the extension processes

To filter Twitch live-stream ads, pUDblock reads Twitch playlist request URLs, HLS playlist contents, channel names, video quality information and ad markers. It keeps per-tab activity counters and the latest filtering result. Processing is limited to Twitch and its ttvnw.net streaming hosts.

Playback URLs and responses can contain short-lived stream-access tokens. pUDblock handles these in memory to match and request streams. It does not ask for or save your Twitch password, and does not send your account credentials or viewing history to the publisher. Existing Twitch requests and player code continue to run as provided by Twitch.

If no clean backup is available, pUDblock hides and mutes the video while normal playback requests, including ad data, may continue underneath. It reads video buffer/seek state to restore clean playback, keeps the previous mute setting in memory, and can ask Twitch to reset its own player once clean content returns. That reset uses Twitch's normal playback requests. It does not read chat or send player information to the publisher.

## Network requests and recipients

Normal playback requests go to Twitch and its streaming CDNs. When the alternate-stream switch is on and an ad is detected, pUDblock may also request an anonymous playback token and alternate playlist directly from Twitch. Those requests identify the Twitch channel being watched and a player type, such as popout or embed.

In both browsers, anonymous backup requests originate from the currently open Twitch page. They omit cookies and do not copy your Twitch account authorization. Firefox uses a bundled page helper for those requests; the website can observe its own page context. Playback tokens and signed backup URLs are handled transiently in the browser and are not sent to the publisher.

Twitch and its CDNs receive the IP address and request information necessary to answer those requests. Their own privacy practices apply. There is no pUDblock relay server, analytics service, advertising tracker or remote log-upload endpoint. No viewing information is sent to the publisher.

## Local storage and retention

The filtering and alternate-stream switches are saved in local extension storage. Firefox keeps channel mappings, cached playback URLs and counters in background memory. Chrome keeps channel mappings and cached playback URLs in page/worker memory and stores tab counters in browser session storage so its service worker can restart without losing status.

Caches and tab records are bounded. Tab records are removed when the tab closes. Firefox memory is reset when the add-on or browser restarts; Chrome session records are cleared when the browser session ends or the extension is reloaded or removed. Settings remain until changed or the extension is uninstalled.

## Your choices

You can switch filtering off from the popup. You can separately disable alternate streams to stop pUDblock's additional playback-token and backup-playlist requests. Twitch's ordinary website traffic continues independently of the extension.

Uninstalling pUDblock removes its locally saved extension settings. This does not delete data held by Twitch or your browser's own browsing history. Firefox's installation prompt discloses the browsing-activity data sent to Twitch for the alternate-stream feature.

## Donations and external links

The optional support link opens https://buymeacoffee.com/pudpodpid

Buy Me a Coffee is contacted only if you choose to follow that link. Donations and any payment or account information are handled by that website, under its own terms and privacy policy. pUDblock does not process payments or receive payment-card details. The support profile likewise opens only when you choose its link.

## No sale, advertising or analytics

The publisher does not collect, sell, license, share or monetize users' browsing data. Any information pUDblock handles is used only to provide its visible Twitch filtering and status features. Its handling follows the Chrome Web Store User Data Policy, including the Limited Use requirements.

## Changes and contact

This policy covers the packaged Firefox and Chrome builds of pUDblock. If a future version changes data handling, the policy and any necessary browser/store disclosures will be updated before that change is released.

Questions about this policy can be directed to pudpodpid through the public support/contact profile: https://github.com/pudpodpid
