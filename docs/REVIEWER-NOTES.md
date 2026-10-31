# Reviewer notes — pUDblock 1.0.3

Publisher/support: pudpodpid — https://github.com/pudpodpid

This is a desktop Twitch live-stream playlist filter. Both browser folders
include readable local source, project/upstream licenses, the cat icons and a
privacy page. There are no runtime npm dependencies, analytics, relay servers,
remote filter scripts, account login forms or payment handling.

## Testing

1. Open a public Twitch live channel and begin playback. Twitch may show a
   "Start Watching" audience warning for an anonymous session.
2. Open the pUDblock popup. "Checking live stream" and increasing "Playlists
   checked" confirm playlist processing, independent of whether an ad appears.
3. Test the filtering and alternate-stream switches. Reload the Twitch tab
   after enabling Chrome filtering if it was initially loaded while off.
4. With no clean backup, the in-page video is hidden/muted while its normal
   playlist remains playable. Once clean video is found, the player is reset
   at most once per fallback (15-second cooldown), then seeks to fresh buffered
   content before the saved mute preference is restored. The page is not reloaded.
5. Hover or keyboard-focus the counters for explanations. The Privacy link
   opens a bundled static document. The optional donation link opens the
   publisher's Buy Me a Coffee page only after a click.

`npm ci` followed by `npm run release` reproduces synchronization, checks and
packages using Node.js 24+. `npm run test:firefox` and `npm run test:chrome`
run fresh-profile local fixtures that inject marked ad playlists. They cover
page and worker paths; Chrome also tests module/Blob workers, immediate Blob
URL revocation, cross-realm mappings and extension service-worker restart.
The UI recovery fixture controls decoded-media ranges and seek completion;
it tests the real page scripts/DOM/messages, not Twitch's real decoder.
These test-only copies have localhost permission; shipped manifests do not.

The original live checks confirmed playlist detection and playback. Sustained
blocking through repeated real Twitch ad breaks has not been verified.

Version 1.0.2 adds local backup-search diagnostics and stops treating cancelled
or timed-out lookups as negative cache entries. Reports show only controlled
error summaries, HTTP status, video formats and a local timestamp. They omit
request URLs, playback tokens and server error bodies, and are never uploaded.
Chrome's isolated bridge bounds diagnostic strings to 700 characters. Diagnostics
are cleared on channel changes and retained under the existing per-tab limits.
The previous Mozilla-signed 1.0.1 artifact is preserved separately; this build
requires its own signature.

Version 1.0.3 routes Firefox's anonymous backup requests through a bundled
MAIN-world Twitch-page helper, matching Chrome's page-origin transport. The
background delegates only validated token descriptors (channel/player type;
the query and headers are fixed locally) or HTTPS `ttvnw.net` HLS URLs. The page
helper uses captured native fetch, `credentials: omit`, no copied account
authorization, no redirects and a one-MiB response limit. Request/reply messages
are scoped to the same window/origin, bounded and treated as untrusted. The
bridge exposes no privileged/background fetch to the website. Cancellation
propagates through the isolated script to the page's AbortController.

Firefox tracks its own pending page backup HLS URLs and excludes them from the
response filter. This avoids recursively intercepting the helper's master/media
requests. Resolver caches are isolated by tab/frame/master session. No new host
or API permissions, CSP changes, remote executable scripts or user privacy
settings are required. A native Firefox fixture deliberately rejects all
background backup fetches and verifies clean substitution through the real page
bridge in page and classic/Blob workers, request anonymity and no recursion.

`node scripts/compare-backups.mjs caedrel` is an optional, network-dependent
diagnostic. It copies the browser folders into test-only directories, starts
fresh profiles, observes primary stream formats, and probes an anonymous backup
for Source quality using each browser's actual transport. It does not force a
real Twitch ad or prove the cause of a previous fallback. It saves sanitized
HTTP/format/timing summaries under `.test-artifacts/`; signed URLs/tokens remain
only in transient memory. This helper is not bundled with either extension.

## Shared filtering engine

The core is adapted from the MIT-licensed implementation credited in CREDITS.md.
It detects stitched-ad and SCTE cue markers and tries anonymous popout/embed
playback tokens at the matching quality. Version 1.0.1 replaces the browser's
destructive stripping fallback with a hidden/muted waiting view that preserves
normal playback and can still download ad data. The pure segment-rewrite
helpers remain in the shared engine/tests as upstream reference code.
Encrypted and byte-range playlists are left intact.

Both browsers bundle `player-guard.js` in the page's MAIN world. Firefox's
isolated content script acknowledges that the waiting view was applied before
the background returns an ad-bearing response. Chrome workers similarly wait
for a presentation acknowledgement from the parent page. No privileged fetch
or account data is exposed through those messages. The guard uses standard
video buffer/seek APIs plus a bounded optional Twitch React player `setSrc`
reset, following the upstream browser integration approach. The private player
API can change; there is no guarantee of live recovery or store approval.

The public Twitch web-client identifier is not a secret. Alternate requests
use `credentials: omit`; pUDblock does not ask for or copy account passwords.
Signed stream URLs and cached alternate tokens remain in memory only. The
publisher receives no stream information or diagnostics.

## Firefox

Manifest V2 uses `webRequest.filterResponseData` on scoped `ttvnw.net` playlist
requests. Both request and initiator host permissions are included. The
`browsingActivity` transmission declaration covers channel-specific alternate
playback requests to Twitch. All processing otherwise stays in the browser.
The final ID is `pudblock@pudpodpid`; minimum desktop version is 140.

## Chrome

Manifest V3 uses `webRequest` only for passive request counts. Document-start
MAIN-world scripts wrap fetch in the page and dedicated playback workers.
The original page-created Blob source is retained and combined with a local
bootstrap so immediate Blob URL revocation still works. For a same-origin
script URL, the worker imports the original Twitch script. The website's own
player source continues to execute in its page/worker context; no remote
ad-blocking script is fetched.

The bootstrap contains bundled core/runtime functions serialized with
`toString`, not eval or Function constructors. No CSP header is removed or
relaxed. The isolated content bridge exposes configuration and bounded status
telemetry, not privileged fetch or scripting commands. Its MAIN-world messages
are treated as untrusted and sanitized. The service worker stores counters
in session storage so suspension/restart preserves them.

This worker approach is disclosed for review under the Manifest V3 code rules.
No prior Chrome Web Store approval is claimed.
