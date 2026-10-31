import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const config = JSON.parse(await fs.readFile(path.join(root, "release.config.json"), "utf8"));
assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
assert.equal(new URL(config.supportUrl).protocol, "https:");
for (const browser of ["firefox", "chrome"]) {
  const folder = path.join(root, browser);
  const manifest = JSON.parse(await fs.readFile(path.join(folder, "manifest.json"), "utf8"));
  assert.equal(manifest.version, pkg.version, `${browser} version differs from package.json`);
  assert.equal(manifest.name, "pUDblock");
  assert.equal(manifest.author, config.publisher);
  assert.equal(manifest.homepage_url, config.supportUrl);
  assert.ok(manifest.description.length <= 132);
  for (const name of ["privacy.html", "privacy.css", "LICENSE", "NOTICE.md", "licenses/playlist-engine.txt", "licenses/TwitchAdSolutions.txt"]) await fs.access(path.join(folder, name));
  const popup = await fs.readFile(path.join(folder, "popup.html"), "utf8");
  assert.ok(popup.includes('href="privacy.html"'));
  assert.ok(popup.includes(config.donationUrl));
  assert.doesNotMatch(popup, /development build|experimental/i);
  const permissionText = JSON.stringify([manifest.permissions, manifest.host_permissions, manifest.content_scripts]);
  assert.doesNotMatch(permissionText, /localhost|127\.0\.0\.1|<all_urls>|debugger/);
  if (browser === "firefox") {
    assert.equal(manifest.browser_specific_settings.gecko.id, "pudblock@pudpodpid");
    assert.deepEqual(manifest.browser_specific_settings.gecko.data_collection_permissions.required, ["browsingActivity"]);
  } else assert.equal(manifest.manifest_version, 3);
}
for (const common of ["popup.html", "popup.css", "ui-state.js", "player-guard.js", "privacy.html", "privacy.css", "LICENSE", "NOTICE.md", "licenses/playlist-engine.txt", "licenses/TwitchAdSolutions.txt"]) {
  assert.ok((await fs.readFile(path.join(root, "firefox", common))).equals(await fs.readFile(path.join(root, "chrome", common))), `Shared file differs: ${common}`);
}
console.log(`Release metadata, privacy pages, license notices and browser separation passed for v${pkg.version}.`);
if (!config.publicPrivacyUrl) console.log("Store submission still needs a publicly hosted PRIVACY.md URL; the bundled policy is already available in the extension.");
