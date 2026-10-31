// Common files are maintained in firefox/ and copied into the self-contained
// Chrome folder. The Chrome adapter files are maintained directly in chrome/.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import "./generate-privacy.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const firefox = path.join(root, "firefox");
const chrome = path.join(root, "chrome");
await fs.mkdir(chrome, { recursive: true });
for (const name of ["popup.html", "popup.css", "ui-state.js", "player-guard.js", "privacy.html", "privacy.css", "LICENSE", "NOTICE.md", "icons", "licenses"]) {
  await fs.cp(path.join(firefox, name), path.join(chrome, name), { recursive: true, force: true });
}
const original = await fs.readFile(path.join(firefox, "core.js"), "utf8");
if (!original.includes("(() => {") || !/\}\)\(\);\s*$/.test(original)) throw new Error("Unexpected core wrapper");
const core = original.replace("(() => {", "function installPudblockCore() {")
  .replace(/\}\)\(\);\s*$/, "}\nglobalThis.PudblockInstallCore = installPudblockCore;\ninstallPudblockCore();\n");
await fs.writeFile(path.join(chrome, "core.js"), core);
const popup = await fs.readFile(path.join(firefox, "popup.js"), "utf8");
await fs.writeFile(path.join(chrome, "popup.js"), '(() => {\nconst browser = globalThis.chrome;\n' + popup + '\n})();\n');
console.log("Synced pUDblock popup, icons, licenses and filtering core into chrome/.");
