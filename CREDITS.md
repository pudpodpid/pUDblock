# Credits

Original contributions to pUDblock are copyright (c) 2026 pudpodpid
and licensed under the [MIT license](LICENSE). Third-party portions retain
their original copyright and license notices as described below.

The stream playlist filtering engine is adapted from
[PureTV by dhawal-ss](https://github.com/dhawal-ss/puretv), which is MIT licensed.
Thank you to its author and contributors for making the implementation available.

The source reference is commit
`d6c2ada57275898994fae5f9fae45e299f18e530` (2026-10-26).
The shared JavaScript in `firefox/core.js` and `chrome/core.js` adapts these Kotlin components from
`core/src/commonMain/kotlin/com/puretv/twitch/core/`:

- `adblock/AdMarkers.kt`
- `adblock/ManifestRewriter.kt`
- `adblock/AdBlockEngine.kt` (leading ad-tail detection)
- `adblock/HlsTimelineNormalizer.kt`
- `adblock/BackupStreamResolver.kt`
- `stream/StreamResolver.kt`
- `stream/TwitchGqlClient.kt` (playback-token query)
- `api/TwitchConfig.kt` (public web-client identifier)

Copyright (c) 2026 dhawal-ss. The complete upstream MIT license is retained in
the extension package's
[Firefox playlist-engine license](firefox/licenses/playlist-engine.txt) and
[Chrome playlist-engine license](chrome/licenses/playlist-engine.txt).

PureTV credits [pixeltris/TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions)
and its `vaft` variant as the reference for the underlying approach. Its reference
document pins vaft version 37.0.0, SHA-256
`06861594a5e6e984ec3da73a4f25d84bea6a816b97ab7cbf4c80fa205583b3ee`.
No vaft userscript is bundled or executed in this extension. Its upstream MIT
notice is retained in
[the reference license](firefox/licenses/TwitchAdSolutions.txt), also included
in the Chrome package.

The Firefox request interception, Chrome page/worker adapter and service worker,
popup, tests and packaging were added for this extension. The Chrome worker
hook follows the same browser integration approach described by the upstream
reference, with locally bundled code, no eval and support for Blob URL revocation.
The browser adaptations require matching backup video formats, exclude
unsupported encrypted/byte-range playlists and handle both Twitch API versions.
Version 1.0.1 adds a browser waiting/mute guard and bounded player reset, using
PureTV's player-level black-frame/recovery approach and the Twitch player
integration described in pixeltris/TwitchAdSolutions. The previous destructive
browser segment-stripping fallback is no longer used; its pure transformation
helpers remain in the shared engine and tests. The waiting view preserves
normal stream traffic, which can include ad data.

The cat artwork was supplied by pudpodpid, who generated it with ChatGPT
using their own cat as the subject. The original image is retained in
`assets/cat-original.png`; the extension icons are resized copies.

This is an independent project, unaffiliated with the credited projects,
Twitch, Mozilla or Google.
