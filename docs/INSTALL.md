# Install pUDblock 1.0.3

The Firefox and Chrome packages are separate. Both include the cat icon,
filtering switches, activity counters, counter tooltips, optional support link
and a privacy page.

## Firefox

[**Install pUDblock 1.0.3 for Firefox**](https://github.com/pudpodpid/pUDblock/releases/download/v1.0.3/pudblock-1.0.3-firefox-signed.xpi)

Open the link in Firefox and confirm **Add** if an installation prompt appears.
This Mozilla-signed version stays installed after Firefox restarts. If the file downloads instead, open
`about:addons`, click the gear icon, choose **Install Add-on From File…**, and
select the downloaded `.xpi`. Remove any temporary development copy first,
then reload open Twitch live channels after installing or updating.

### Temporary development installation

Local build files:

- `firefox/pudblock-1.0.3-firefox.zip` — source package for Mozilla submission or temporary testing.
- `firefox/pudblock-1.0.3-unsigned.xpi` — the same extension in XPI format, explicitly unsigned.

For temporary testing, open `about:debugging#/runtime/this-firefox`, choose
**Load Temporary Add-on**, and select the Firefox ZIP or the source folder's
`manifest.json`. Reload any open Twitch channel afterward.

Normal permanent installation in release Firefox requires the XPI returned by
Mozilla after signing. The word `unsigned` in this package's filename is
intentional: changing a filename does not sign an extension. Temporary add-ons
are removed when Firefox restarts.

Version 1.0.0 uses the final add-on ID `pudblock@pudpodpid`. Remove older
development copies before installing it so two builds do not filter the same
requests. The new ID starts with its own default switch settings.

Version 1.0.1 keeps that same ID. To update a 1.0.0 development installation,
reload/replace the extension and reload the Twitch tab once; saved switches
are retained. That tab reload is needed to attach the new waiting/recovery scripts.

Version 1.0.3 keeps that same ID and moves Firefox's backup requests into the Twitch page context.
Reload the extension and the Twitch tab once after updating so the new helper
is installed. Use the signed download above for permanent installation.
Future builds require their own Mozilla signature; the earlier signed 1.0.1
release is preserved separately.

## Chrome

[**Install pUDblock for Chrome**](https://chromewebstore.google.com/detail/pudblock/jbklilapclblienckckaidplcbjhpife)

1. Open the store page in Chrome and click **Add to Chrome**.
2. Confirm **Add extension**.
3. Open or reload a Twitch live channel, then click the pUDblock cat icon.

If you previously installed an unpacked development copy, remove that copy
from `chrome://extensions` before installing the store version.

### Developer installation (unpacked)

To load the source locally for development:

1. [Download the project ZIP](https://github.com/pudpodpid/pUDblock/archive/refs/heads/main.zip)
   and extract it into a folder you intend to keep.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the `chrome/` folder inside the extracted
   project (`pUDblock-main/chrome`), which contains `manifest.json`.
4. Open or reload a Twitch live channel.

Keep the extracted project in the same location. To update, replace its files,
click **Reload** on the extension card, and reload Twitch.

### Local Chrome build package

`chrome/pudblock-1.0.3-chrome.zip` is the Chrome Web Store upload package and
can also be extracted for a local installation:

1. Extract the Chrome ZIP into a folder you intend to keep.
2. Open `chrome://extensions` and enable **Developer mode**.
3. Click **Load unpacked** and select the extracted folder containing `manifest.json`.
4. Open or reload a Twitch live channel.

If you have this source project, select its `chrome/` folder directly.
For normal installation, use the Chrome Web Store link above. The ZIP is not
a directly installable CRX. Removing or moving the unpacked folder can break
a developer installation.

## Confirm it is active

Open a Twitch live channel and click the pUDblock cat icon. **Checking live
stream** and an increasing **Playlists checked** count confirm processing,
even when there is no ad. The other two counters count hidden-ad fallback
refreshes and clean backup refreshes, not unique advertisements.

If Firefox hides/mutes during a break while Chrome finds a backup, expand
**Connection details** in version 1.0.2 or newer. **Last backup search** shows the target
format and the actual failure reason for each attempted player type. Share
that text together with the channel and time when reporting an issue.

**No stream requests detected** does not confirm protection. Reload the Twitch
tab after installing or updating. If all available playlists contain ads,
the video is hidden and muted while the underlying stream traffic continues;
ad data may still download. When clean video returns, pUDblock attempts one
player reset, waits for fresh buffered media and restores the original mute
setting. If Twitch changes its private reset API or playback remains stuck,
the waiting screen points to the player's reload control. The fallback does
not support picture-in-picture or casting.

Support/contact profile: https://github.com/pudpodpid

The Firefox download above is Mozilla-signed. Locally generated Firefox build
packages are unsigned. Chrome is available from the Chrome Web Store link above;
the Developer mode instructions are for local source installations.
