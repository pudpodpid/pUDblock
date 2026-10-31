// Explicit, optional publication step. Never called by npm run release.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import webExt from "web-ext";
const root = fileURLToPath(new URL("../", import.meta.url));
const pkg = JSON.parse(await fs.readFile(path.join(root, "package.json"), "utf8"));
const apiKey = process.env.WEB_EXT_API_KEY;
const apiSecret = process.env.WEB_EXT_API_SECRET;
if (!apiKey || !apiSecret) {
  console.error("Mozilla signing requires WEB_EXT_API_KEY and WEB_EXT_API_SECRET in your local environment. No files were uploaded.");
  console.error("See RELEASING.md. Do not paste API secrets into chat or commit them to Git.");
  process.exitCode = 1;
} else {
  await webExt.cmd.sign({ sourceDir: path.join(root, "firefox"), artifactsDir: path.join(root, "releases", `v${pkg.version}`, "firefox-signed"), channel: "unlisted", apiKey, apiSecret }, { shouldExitProgram: false });
}
