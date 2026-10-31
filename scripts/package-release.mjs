import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";

const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const config = JSON.parse(await fs.readFile(path.join(root, "release.config.json"), "utf8"));
const version = pkg.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Release version must be numeric semver");
const archiveDate = new Date(`${config.policyUpdated}T00:00:00Z`);
if (Number.isNaN(archiveDate.getTime())) throw new Error("Invalid release date");
const releaseFolder = path.join(root, "releases", `v${version}`);
const artifacts = [];
async function writeArtifact(name, contents) {
  const destination = path.join(releaseFolder, name);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, contents);
  const bytes = Buffer.isBuffer(contents) ? contents : Buffer.from(contents);
  artifacts.push({ name, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") });
}
for (const browser of ["firefox", "chrome"]) {
  const bytes = await fs.readFile(path.join(root, "dist", browser, `pudblock-${version}.zip`));
  const zip = await JSZip.loadAsync(bytes);
  const manifest = JSON.parse(await zip.file("manifest.json").async("string"));
  if (manifest.version !== version || manifest.name !== "pUDblock") throw new Error("Built manifest differs from release metadata");
  for (const required of ["privacy.html", "privacy.css", "LICENSE", "NOTICE.md", "licenses/playlist-engine.txt", "licenses/TwitchAdSolutions.txt"]) {
    if (!zip.file(required)) throw new Error(`Missing ${browser} release file: ${required}`);
  }
  for (const entry of Object.values(zip.files).filter(entry => !entry.dir)) {
    if (/(^|\/)(node_modules|\.git|\.test-artifacts|tests|scripts)(\/|$)|\.(pem|key)$/i.test(entry.name)) throw new Error("Unexpected development/private file in extension archive");
    const source = await fs.readFile(path.join(root, browser, entry.name));
    if (!source.equals(await entry.async("nodebuffer"))) throw new Error(`Stale release entry: ${browser}/${entry.name}`);
  }
  await writeArtifact(`${browser}/pudblock-${version}-${browser}.zip`, bytes);
  if (browser === "firefox") await writeArtifact(`firefox/pudblock-${version}-unsigned.xpi`, bytes);
}
const sourceZip = new JSZip();
async function addSource(relative) {
  const archivePath = relative.replaceAll(path.sep, "/");
  if (/(^|\/)(node_modules|\.git|\.reference|\.test-artifacts|dist|releases)(\/|$)|\.(pem|key)$|(^|\/)\.env(?:\.|$)/i.test(archivePath)) throw new Error(`Private/generated material cannot be included in source archive: ${archivePath}`);
  const item = await fs.lstat(path.join(root, relative));
  if (item.isSymbolicLink()) throw new Error("Source archive does not follow symlinks");
  if (item.isDirectory()) {
    for (const name of (await fs.readdir(path.join(root, relative))).sort()) await addSource(path.join(relative, name));
  } else {
    sourceZip.file(`pudblock-${version}-source/${archivePath}`, await fs.readFile(path.join(root, relative)), { date: archiveDate });
  }
}
for (const name of ["package.json", "package-lock.json", ".gitignore", "LICENSE", "README.md", "CREDITS.md", "PRIVACY.md", "CHANGELOG.md", "RELEASING.md", "release.config.json", "docs", "firefox", "chrome", "scripts", "tests", "assets"]) await addSource(name);
await writeArtifact(`pudblock-${version}-source.zip`, await sourceZip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 9 } }));
for (const name of ["INSTALL.md", "STORE-LISTING.md", "REVIEWER-NOTES.md"]) await writeArtifact(name, await fs.readFile(path.join(root, "docs", name)));
await writeArtifact("PRIVACY.md", await fs.readFile(path.join(root, "PRIVACY.md")));
await writeArtifact("CHANGELOG.md", await fs.readFile(path.join(root, "CHANGELOG.md")));
const metadata = {
  name: "pUDblock", version, publisher: config.publisher, date: config.policyUpdated,
  firefox: { id: "pudblock@pudpodpid", signed: false, status: "Requires Mozilla signing for permanent installation in normal Firefox" },
  chrome: { signedByStore: false, status: "Store-upload ZIP and unpacked developer installation; not a directly installable CRX" },
  publicPrivacyUrl: config.publicPrivacyUrl,
  verification: "Run npm run release to generate only after unit, manifest and real-browser fixture checks pass.",
  liveAdBreakVerified: false,
  artifacts: [...artifacts]
};
await writeArtifact("release.json", JSON.stringify(metadata, null, 2) + "\n");
const sums = artifacts.map(item => `${item.sha256}  ${item.name}`).join("\n") + "\n";
await fs.writeFile(path.join(releaseFolder, "SHA256SUMS.txt"), sums);
console.log(`pUDblock v${version} release assembled in ${releaseFolder}`);
console.log("Firefox XPI is explicitly unsigned. Chrome ZIP is prepared for store upload or unpacked loading.");
