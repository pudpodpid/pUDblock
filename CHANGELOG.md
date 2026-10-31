# Changelog

## 1.0.3 — 2026-10-31

- Route Firefox backup-token and playlist requests through the Twitch page context, matching Chrome's request origin. This targets a reported failure of both Firefox background token requests; the precise network-layer block was not established.
- Use fixed, locally generated anonymous token queries and HTTPS Twitch-CDN HLS URL validation. Omit cookies and copied authorization; bound response sizes and propagate cancellation.
- Exclude the helper's own HLS requests from Firefox's response filter to avoid recursive interception.
- Isolate Firefox resolver caches by tab, frame and master-playlist session.
- Add a native Firefox regression fixture where background backup fetches are deliberately blocked, verifying successful page/worker backup substitution, anonymity, no recursion and fallback on genuine HTTP errors.
- Keep Chrome's backup transport unchanged. Both builds use the same locally generated token request.

The updated Firefox page bridge obtained a compatible clean 1080p60 backup on
Caedrel in a live probe. This is not yet confirmation of the fix in the user's
specific Firefox profile during a real ad break. Firefox 1.0.3 needs a new
Mozilla signature; previous release files remain unchanged.

## 1.0.2 — 2026-10-31

- Fix cancelled/timed-out backup lookups being cached as unavailable for 15 seconds. This can affect Firefox more broadly because it shares one resolver across tabs and qualities.
- Preserve a successful cached backup master when an individual media request is cancelled.
- Keep a newer pending lookup intact when an older operation finishes after a cache reset.
- Add local **Last backup search** details: requested resolution/frame rate/codecs and outcomes for popout/embed, including HTTP failures, timeouts, cancellation, ads, incompatible formats and older playback windows.
- Keep diagnostic messages bounded and exclude signed URLs, tokens and upstream error bodies. No additional telemetry or permissions.
- Add a fresh-profile Firefox/Chrome comparison helper and regression tests for cancellation caching and diagnostic propagation.

Both browsers obtained a matching clean 1080p60 backup in a Caedrel probe. The
exact cause of the user's earlier Firefox fallback was not captured by 1.0.1;
the new diagnostics are intended to identify it if it recurs. This is not a
claim that Firefox and Chrome will always receive identical Twitch responses.
The signed 1.0.1 artifact is preserved. Firefox 1.0.2 needs a new Mozilla signature.

## 1.0.1 — 2026-10-31

- Fix the no-backup path returning empty or shortened HLS windows that made Twitch show a false offline screen.
- Preserve the normal playlist and hide/mute the video while waiting for a clean primary or alternate stream; ad data may still download underneath.
- Attempt one player reset after clean video returns, wait for fresh buffered media, seek to the live edge and restore the original mute setting. Player resets have a 15-second cooldown; the page is never automatically reloaded.
- Rename the middle counter to **Hidden ad refreshes** so it describes the new fallback accurately.
- Reject all-stale backup windows without advancing the timeline or returning an empty playlist.
- Add clean → ad-only → clean regression checks, waiting-view acknowledgements, and native-browser UI checks for mute/restoration and one bounded reset.

The recovery UI tests use controlled media ranges. Recovery through real
Twitch ad breaks still needs verification; Twitch's private reset API can change.

## 1.0.0 — 2026-10-31

- Separate Firefox and Chrome extension packages with matching pUDblock branding.
- Cat toolbar/add-on icons, filtering switches and optional alternate-stream fallback.
- Per-tab activity, clean-backup and filtered-refresh counters with accessible tooltips.
- Twitch API v1/v2 stream detection, matching-quality backup selection and local HLS ad filtering.
- Chrome page/worker integration, Blob URL revocation support and status retention across service-worker restarts.
- Bundled privacy policy, public Markdown policy and accurate first-party Twitch transmission disclosure.
- Stable Firefox release identifier: `pudblock@pudpodpid`.
- MIT project license for pudpodpid and separate upstream notices in both packages.
- Optional Buy Me a Coffee support link.
- Release archives, unsigned Firefox XPI, store-upload ZIPs, source archive and SHA-256 checksums.

Known limits: a clean alternate stream is not always available; video may
buffer during an ad break. Encrypted and byte-range playlists are passed
through. Sustained playback through repeated live ad breaks is not verified.
Signing and public store publication are separate steps.
