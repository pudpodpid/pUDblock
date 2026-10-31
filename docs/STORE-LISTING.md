# Store listing draft — pUDblock 1.0.3

Publisher: **pudpodpid**

Support/contact URL: https://github.com/pudpodpid

Public privacy-policy URL: https://github.com/pudpodpid/pUDblock/blob/main/PRIVACY.md

## Name

pUDblock

## Short description

Local Twitch ad filtering. Clean backups first; ads hidden and muted when a clean stream is unavailable.

## Full description

pUDblock helps filter ads from Twitch live-stream playlists on your device.
When a playlist contains an ad, it can try an alternate stream at the same
video quality. If no compatible clean stream is available, it hides and mutes
the video with a waiting screen until clean content returns. The player's
normal traffic can continue underneath, including downloading ads. The
extension attempts a bounded player reset and seeks to fresh buffered video
before restoring the original mute setting.

Features:

- Filtering switch and a separate alternate-stream switch.
- Per-tab activity and filtering status, with counters explained by tooltips.
- Local backup-search details explaining why an alternate stream could not be used.
- Support for the current v1/v2 Twitch live playlist routes.
- The pUDblock cat icon and a compact popup.
- Optional support link; donations are not required to use any feature.

The publisher receives no viewing history, analytics or logs. Playlist data
is processed locally. If alternate streams are enabled, channel-specific
playback-token and playlist requests go directly to Twitch and its CDNs.
See the privacy policy for details of local storage and network requests.

pUDblock is for Twitch live streams. It does not filter clips, VODs or ads on
other websites. Twitch changes may affect functionality. Some streams cannot
be filtered, and uninterrupted or completely ad-free playback is not
guaranteed. Encrypted/byte-range playlists are passed through. The hidden-ad
fallback is intended for the in-page player; picture-in-picture and casting
are not supported by that fallback.

Independent of Twitch, Mozilla and Google. Original project contributions
are MIT licensed; upstream notices are included.

## Permission explanations

- `storage`: remembers the switches; Chrome also retains tab status in browser session storage.
- Twitch/ttvnw.net host access: matches Twitch live playlists and requests alternate streams only for the current channel.
- Firefox `webRequest` / `webRequestBlocking`: observes and locally filters playlist responses.
- Chrome `webRequest`: observes playlist activity for the popup; the page/worker adapter performs filtering.
- Firefox required `browsingActivity` transmission declaration: the alternate-stream feature sends the currently watched channel to Twitch, not to the publisher.

## Privacy dashboard notes

Copy-ready Chrome permission and remote-code declarations are in
[CHROME-STORE-PRIVACY.md](CHROME-STORE-PRIVACY.md). The current Chrome build
must disclose the original Twitch worker-script imports described there.

Disclose handling of Twitch browsing/request information and website content,
including playlist bodies and stream URLs, even though processing is local.
Do not claim that the extension handles no user information merely because
there is no telemetry. The publisher does not sell data, use it for advertising,
or receive it. Data sent directly to Twitch is limited to playback operations.

State the single purpose as Twitch live-stream ad filtering and status.
No extra login, purchase, account subscription or donation is required by
pUDblock. Normal Twitch access restrictions still apply.

Suggested categories: privacy/security or streaming tools, using the categories
actually offered by each store. Supply genuine screenshots of the current UI;
do not advertise a guaranteed blocking rate or store endorsement.
