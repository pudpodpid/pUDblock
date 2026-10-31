# pUDblock

<img src="firefox/icons/cat-128.png" width="96" height="96" alt="pUDblock cat">

A Twitch live-stream ad blocker for Firefox Desktop and Chrome, published by
[pudpodpid](https://github.com/pudpodpid). Both builds have the same popup, switches, status counters, privacy page and optional support link.
The current release is **1.0.3**.

## Installation

### Firefox

[**Install pUDblock for Firefox — v1.0.3**](https://github.com/pudpodpid/pUDblock/releases/download/v1.0.3/pudblock-1.0.3-firefox-signed.xpi)

Open the link in Firefox. If an installation prompt appears, confirm **Add**.
This is the Mozilla-signed version and stays installed after Firefox restarts.

If Firefox downloads the file instead, open `about:addons`, click the gear
icon, choose **Install Add-on From File…**, and select the downloaded `.xpi`.
Remove any temporary development copy before installing the signed version.
After installing or updating, reload any open Twitch live channel.

### Chrome

The Chrome Web Store submission is **under review**. Install with Developer
mode for now:

1. [Download the project ZIP](https://github.com/pudpodpid/pUDblock/archive/refs/heads/main.zip)
   and extract it into a folder you intend to keep.
2. Open `chrome://extensions` in Chrome.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the **`chrome` folder inside the extracted
   project** (`pUDblock-main/chrome`), which contains `manifest.json`.
5. Open or reload a Twitch live channel, then click the pUDblock cat icon.

Keep the extracted project in the same location so Chrome can load the
extension after restarting. To update, replace the files in that location,
click **Reload** on pUDblock's card at `chrome://extensions`, and reload Twitch.

For local Firefox development and package details, see
[installation instructions](docs/INSTALL.md).

## Separate browser folders

| Folder | Browser | Implementation |
| --- | --- | --- |
| `firefox/` | Firefox Desktop 140+ | Manifest V2 with native response filtering |
| `chrome/` | Chrome 120+ | Manifest V3 with page/worker fetch hooks |

Each folder is a complete, independently loadable extension. Browser settings
and counters are separate.

## Release packages

Run `npm ci` and `npm run release` to create `releases/v1.0.3/`:

| File | Use |
| --- | --- |
| `firefox/pudblock-1.0.3-firefox.zip` | Mozilla submission or temporary Firefox installation |
| `firefox/pudblock-1.0.3-unsigned.xpi` | Firefox XPI archive awaiting Mozilla signing |
| `chrome/pudblock-1.0.3-chrome.zip` | Chrome Web Store submission or extract for developer installation |
| `pudblock-1.0.3-source.zip` | Complete project source, build scripts and tests |
| `SHA256SUMS.txt` | SHA-256 checksums for the release files |

The release also includes installation instructions, privacy policy, changelog
and draft store/reviewer notes. Build outputs are unsigned; use the
Mozilla-signed Firefox download in [Installation](#installation) for permanent
installation. The Chrome Web Store submission is under review; use the
Developer mode steps above until its store link is available. The earlier
signed Firefox 1.0.1 XPI is preserved separately under
`releases/v1.0.1/firefox-signed/`.
See [release/signing instructions](RELEASING.md) for preparing future versions.

## Confirm activity

While video is playing, the popup should show **Checking live stream** and an
increasing **Playlists checked** count even if no ads appear. **No stream
requests detected** means no playlist requests have been observed in this tab;
it does not confirm protection. **Connection details** distinguishes missing
requests, an unlinked stream and a detected channel. A stopped stream shows
**No recent playlist activity** after 20 seconds without a processed response.

In 1.0.2, **Connection details** also shows the last backup search, the requested
resolution/frame rate/codecs, and why each player type succeeded or failed.
Reasons distinguish HTTP/network failures, timeouts, cancellation, ads in the
backup, missing compatible formats and an older backup playback window. These
details stay local and omit signed URLs and playback tokens. See
[backup troubleshooting](docs/TROUBLESHOOTING.md).

## How it works

Both builds use the same playlist filtering engine. A channel's master playlist
associates each video rendition with its channel. Original signed request URLs
and the website's primary playback-token requests are preserved.

Firefox uses `webRequest.filterResponseData` to rewrite live HLS playlist
responses, including those fetched by dedicated workers. Since 1.0.3 its backup
token/playlist requests run in the Twitch page context, matching Chrome's
request origin. An isolated content bridge forwards only a fixed anonymous
playback-token request or an HTTPS Twitch-CDN playlist request to a bundled
MAIN-world helper. It never exposes background fetch to page scripts. Backup
requests are tracked and excluded from the Firefox response filter to prevent
recursion, and cancellation propagates to the page fetch.

Chrome MV3 has no equivalent response-body API. Its adapter is installed at
document start in Twitch's page context and wraps `fetch` in the page and its
dedicated playback workers. Master mappings are shared between those realms.
Original Blob worker source is retained when Twitch immediately revokes a Blob
URL. All extension filtering code is bundled locally; the adapter uses no eval
and does not weaken Twitch's Content Security Policy. Twitch's own player code
continues running in its original page/worker context.

Chrome's service worker stores tab counters in `storage.session`, so suspending
and restarting it does not lose status. The isolated bridge accepts only bounded
status reports from the page and exposes no privileged fetch or scripting API.

On an ad-bearing media refresh, the extension tries a fresh anonymous `popout`
session, then an `embed` session. A backup must be a valid clean playlist with
the same resolution, frame rate and codecs and a usable broadcast sequence
anchor. Successful master responses are cached for 90 seconds, failed master
requests for 15 seconds, and a refresh's backup search has a four-second limit.
Cancelled/timed-out requests do not create failure-cache entries. Firefox 1.0.3
isolates resolvers by tab, frame and master-playlist session; Chrome has separate
instances in the page and each playback worker. Earlier Firefox builds shared
one resolver across tabs and qualities. Version 1.0.2 corrected cancelled
requests being cached as failures, but this did not address the user-reported
network failures during background token requests. Version 1.0.3 moves those
requests into the Twitch page without changing browser privacy settings.

If there is no compatible clean backup, the extension preserves Twitch's
playable playlist and covers/mutes the video with a waiting screen. The player
can continue downloading ads underneath. This fallback hides ads; it does not
replace them with live content or block their network transfer. Deleting an
entire ad-only live window made Twitch stop with a false offline screen in
v1.0.0, so that browser fallback is no longer used.

When clean primary or backup video returns, a shared player guard attempts one
Twitch player reset to discard buffered ads. It waits for fresh buffered video,
seeks to its live edge and restores the previous mute setting. Resets have a
15-second cooldown and never reload the whole page. Twitch's reset API is
private and can change; if it is unavailable the guard uses a standard video
seek. If the player still cannot recover, the waiting view points to its reload
control. Turning filtering off immediately restores video and sound.

## Scope and limits

- Live channels on Twitch with master/media playlists hosted on `*.ttvnw.net`.
  VODs, clips, banners and ads on other websites are outside its scope.
- 70 automated tests pass. Firefox 159 and Chrome 156 headless fixtures verify
  playlist handling, popup settings, worker handling and the waiting/recovery UI.
  Media buffer ranges and seek completion are simulated in the UI fixtures;
  these do not prove Twitch's real decoder will recover during a live break.
  Chrome tests additionally cover
  module workers, immediate Blob URL revocation, cross-realm mappings and
  extension service-worker restart.
- A separate native Firefox fixture deliberately blocks background backup
  fetches. Page-context requests still substitute clean video in page/classic/
  Blob-worker playlists, omit cookies/authorization, and avoid recursive
  filtering. Genuine token-server rejections retain the hidden/muted fallback.
- A separate live Chrome check on xQc processed eight clean playlists with video
  playing and no reported player error. Earlier Firefox live checks also confirmed
  stream detection. **Ad suppression during a live Twitch ad break and sustained
  playback through repeated breaks have not been verified.**
- An anonymous backup comparison on Caedrel found a compatible clean 1920x1080
  60 fps H.264 popout backup in both Firefox's extension background and Chrome's
  Twitch page. This demonstrates backup capability in both transports; it does
  not identify the cause of an earlier, user-reported Firefox fallback.
- Twitch can change ad markers, token endpoints, player behavior or stream
  formats. These dependencies may require maintenance.
- Alternate sessions are anonymous. Subscriber-only streams may have no usable
  backup. The extension does not read or copy your Twitch login credentials.
- Encrypted and byte-range playlists are passed through with an unavailable
  status. Unexpected errors and oversized responses preserve original playback;
  this means ads can pass through when filtering fails. Picture-in-picture and
  casting may not display the in-page waiting screen and are not supported
  targets for the hidden-ad fallback.
- After installing or reloading the add-on, reload already-open live channels
  so the extension can observe their master playlists. A full reload can also
  recover from playback errors.
- Another Twitch playlist blocker may conflict with the same requests. Test
  pUDblock with other Twitch stream-filtering scripts disabled.
- Firefox Desktop and Chrome Desktop are tested targets. Android and other
  browsers have not been tested.
- The Chrome integration runs in the website's JavaScript environment. Twitch
  can change or interfere with those hooks; page workers created before the
  extension loads require a tab reload. Reload Twitch after enabling pUDblock
  if the tab was initially opened with filtering switched off.

## Privacy and permissions

Both builds request `storage` for the switches and host access to `*.twitch.tv`
and `*.ttvnw.net`. Firefox uses `webRequest` and `webRequestBlocking` to filter
responses. Chrome uses `webRequest` only to observe playlist request counts;
its page/worker adapter performs the response changes. Both builds also use
locally bundled page scripts for the mute/waiting view and bounded player reset.

Read the full [privacy policy](PRIVACY.md), also bundled in each extension and
accessible through the popup's **Privacy** link.

Playback-token and playlist requests go directly to Twitch and Twitch's CDNs.
There is no relay server, telemetry, extra login or remotely downloaded add-on
logic. Settings stay in local extension storage. Channel/rendition mappings and
signed backup URLs stay in bounded memory caches. Chrome tab counters use session
storage; Firefox counters stay in background memory. Counters measure playlist
refreshes, not unique advertisements. Firefox's installation prompt declares
the browsing activity sent directly to Twitch for the alternate-stream feature.

## Development

Use Node.js 24 or newer.

```powershell
npm ci
npm run release
```

`npm run start:firefox` and `npm run start:chrome` launch separate development
profiles. The headless tests also use fresh profiles. They do not use your
existing browser profiles or sign in to Twitch. Set `FIREFOX_BINARY` or
`CHROME_BINARY` to override the default installed browser location.

The release command runs synchronization, metadata checks, all unit tests,
manifest/JavaScript validation and both real-browser fixture suites before
building the archives. `npm run build` only builds the browser ZIPs under
`dist/`; it does not run the release checks or assemble the release folder.

Common UI files, icons, licenses and the core engine are maintained in `firefox/`.
`npm run sync` copies them into the independent `chrome/` folder and exposes the
core installer for Chrome workers. Chrome-specific files stay in `chrome/`.
After editing common files, run sync before testing or building Chrome.

Fixture tests create disposable copies under `.test-artifacts/`, replacing only
fixture host matching and disabling network backups in those copies. Shipped
extensions are not granted localhost access. Unit tests cover the backup resolver
with mocked responses. Build and test tools are development dependencies; neither
extension has npm runtime dependencies.

`npm run test:live -- xqc` and `npm run test:live:chrome -- xqc` check real Twitch
detection in Firefox and Chrome respectively. Reports under `.test-artifacts/`
contain request categories, hostnames, counters and generic errors; they omit
signed playlist URLs, cookies and request bodies. These checks require a live
channel and internet access and are separate from deterministic fixture tests.
The Chrome live check acknowledges Twitch's "Start Watching" content warning
when shown in the fresh anonymous profile and verifies that video is playing.

## Credits and licensing

Original project contributions are copyright (c) 2026 pudpodpid and licensed
under the [MIT license](LICENSE).

Source acknowledgements for the GitHub repository are in [CREDITS.md](CREDITS.md).
Third-party portions retain their original MIT copyright and permission
notices in the source and distributed extension. See
[the third-party notices](firefox/NOTICE.md) and bundled licenses in each browser
folder.
This project is independent of Twitch, Mozilla and Google.

## Support

Support/contact: [pudpodpid on GitHub](https://github.com/pudpodpid).

If you'd like to support development: [☕ Buy me a coffee](https://buymeacoffee.com/pudpodpid).
