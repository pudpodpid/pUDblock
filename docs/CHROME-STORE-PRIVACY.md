# Chrome Web Store privacy fields — pUDblock 1.0.3

These declarations describe the current Chrome package. Recheck them whenever
permissions, network behavior, storage or the player integration changes.

## Single purpose

Filter ads in Twitch live streams and show the current tab's filtering status.

## storage justification

Stores the filtering and alternate-stream preferences in chrome.storage.local so they persist across browser restarts. Uses chrome.storage.session to retain per-tab filtering status, activity counters and backup-search diagnostics when the Manifest V3 service worker is suspended. Settings and status records remain in the browser and are not uploaded. Tab records are removed when the tab closes.

## webRequest justification

Observes HTTPS Twitch CDN HLS playlist (.m3u8) requests to associate stream activity with the correct tab, count playlist requests and show connection status in the popup. In Chrome this permission is used for passive observation; bundled page and worker scripts perform playlist filtering. It is not used to block requests or monitor unrelated websites.

## Host permission justification

Access to https://*.twitch.tv/* is needed to run the bundled filtering and player-control scripts on Twitch pages and request anonymous alternate playback tokens from Twitch. Access to https://*.ttvnw.net/* is needed to observe and process live HLS playlists and request compatible clean alternate playlists from Twitch's streaming CDN. Processing is limited to Twitch live-stream playback. Alternate requests identify the currently watched channel and go directly to Twitch and its CDN, not to the developer.

## Are you using remote code?

Select **Yes** for the current 1.0.3 Chrome package and disclose the following:

All pUDblock filtering, configuration and interface code is included in the extension package. To apply the bundled filtering code inside Twitch's playback workers, the page-context worker wrapper preserves Twitch's original player code. For same-origin URL workers, it loads the original Twitch worker script with importScripts() or import(); for page-created Blob workers, it retains their existing source. This executes in the website's worker context without extension APIs. No remotely hosted pUDblock logic or remote ad-blocking script is downloaded.

The worker imports are visible in chrome/page-hook.js. Declaring this behavior
does not establish store approval. Google's Manifest V3 policy describes an
exemption for contexts isolated from extension APIs; reviewers must assess
this implementation and be able to determine its full functionality.

Official references:

- https://developer.chrome.com/docs/webstore/cws-dashboard-privacy#declare_any_remote_code
- https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements

## Privacy policy URL

https://github.com/pudpodpid/pUDblock/blob/main/PRIVACY.md

## Data-handling consistency

The extension handles Twitch playlist URLs, channel names, playlist contents,
temporary playback tokens and local filtering diagnostics. It does not upload
these to its developer. Do not equate absence of analytics with absence of
data handling. Keep the dashboard's data disclosures consistent with PRIVACY.md.
