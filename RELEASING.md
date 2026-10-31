# Release pUDblock

## Build the release

Use Node.js 24 or newer:

```sh
npm ci
npm run release
```

This synchronizes common browser files and generates the privacy documents,
checks versions and release metadata, runs unit tests and both real-browser
fixture suites, validates the manifests and JavaScript, builds the two
extensions, and assembles `releases/v1.0.3/`.

The output contains separate Firefox and Chrome directories, a complete source
archive, installation instructions, draft listing/reviewer notes, the privacy
policy, a release manifest and `SHA256SUMS.txt`. The source archive uses an
allowlist and excludes `node_modules`, browser profiles, test reports, signing
keys, `.env` files and other generated release archives.

Chrome must already be installed for `npm run test:chrome`; override its
location with `CHROME_BINARY`. Override Firefox with `FIREFOX_BINARY`.
Tests launch fresh profiles and do not use your normal browser accounts.

`npm run test:live -- xqc` and `npm run test:live:chrome -- xqc` perform separate,
network-dependent playback/detection checks. These are not deterministic
fixture tests and do not prove effectiveness during a real ad break.

## Firefox signing and distribution

The generated `*-unsigned.xpi` is a proper XPI-format archive, but is not signed.
Normal Firefox requires Mozilla signing for permanent installation. Choose
either a public AMO listing or unlisted signing and self-distribution.

For web submission, upload the Firefox ZIP/XPI through the
[Mozilla Add-on Developer Hub](https://addons.mozilla.org/developers/).
Use `docs/REVIEWER-NOTES.md`, and provide the source archive when requested.
Select desktop platforms; Android is not a tested release target.

An optional local command signs an **unlisted** build using your own Mozilla
API credentials:

```sh
npm run sign:firefox
```

Set `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` in your local environment first,
using credentials from your Mozilla developer account. Never paste secrets
into chat, store them in release files or commit them to Git. Running the
command uploads the Firefox source to Mozilla; `npm run release` does not.
Without both credentials the command stops before uploading anything.

Signed results are kept separately in `releases/v1.0.3/firefox-signed/`.
Distribute the actual signed XPI returned by Mozilla. The original checksum
file covers the original unsigned release artifacts, so create a separate
checksum for any subsequently signed file.

Keep `pudblock@pudpodpid` unchanged after the first signed release. Changes to
the add-on ID produce a different extension, not an update.

## Chrome Web Store

Upload `chrome/pudblock-1.0.3-chrome.zip` from the release directory to your
Chrome Web Store developer dashboard. `manifest.json` is at the archive root.
Google assigns the listing identity and produces the distributed Chrome
extension after review/publication. A locally packed CRX does not replace
store publication for normal Windows/macOS distribution.

Use `docs/STORE-LISTING.md` and `docs/REVIEWER-NOTES.md` as submission drafts.
Publish `PRIVACY.md` at a stable public URL first, enter that URL in the store
dashboard, and set `publicPrivacyUrl` in `release.config.json` for subsequent
release records. A GitHub profile URL is a temporary support/contact page,
not the public privacy-policy URL.

The Chrome worker integration is described in the reviewer notes. It has not
been approved by Google; do not describe this package as store-approved.

## Before uploading

- Review the public listing text and privacy disclosures against the actual build.
- Replace the temporary GitHub profile support URL with a repository/issues URL when the repository exists.
- Supply the account/contact, privacy URL, screenshots and any developer/trader details requested by each store.
- Review the current platform policies and the Twitch-specific contractual questions discussed for this project.
- Keep the MIT and third-party notices in every distributed copy.

The publisher is pudpodpid. Neither a version number nor store approval is a
legal clearance or a guarantee that every Twitch ad will be removed.

Official guides:

- [Mozilla signing and distribution](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/)
- [Chrome upload preparation](https://developer.chrome.com/docs/webstore/prepare)
- [Chrome installation methods](https://developer.chrome.com/docs/extensions/how-to/distribute/install-extensions)
