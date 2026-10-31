import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../chrome/", import.meta.url));
const manifest = JSON.parse(await fs.readFile(path.join(root, "manifest.json"), "utf8"));
assert.equal(manifest.manifest_version, 3);
assert.equal(manifest.name, "pUDblock");
assert.ok(!manifest.permissions.includes("webRequestBlocking"));
assert.ok(!manifest.permissions.includes("debugger"));
const files = [manifest.background.service_worker, manifest.action.default_popup,
  ...Object.values(manifest.icons), ...manifest.content_scripts.flatMap(item => item.js)];
for (const name of files) await fs.access(path.join(root, name));
for (const name of (await fs.readdir(root)).filter(name => name.endsWith(".js"))) {
  execFileSync(process.execPath, ["--check", path.join(root, name)], { stdio: "pipe" });
}
console.log("Chrome manifest, packaged paths and JavaScript syntax passed.");
