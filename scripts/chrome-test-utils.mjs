import puppeteer from "puppeteer-core";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const root = fileURLToPath(new URL("../", import.meta.url));
export const chromeBinary = process.env.CHROME_BINARY || (process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "google-chrome");
export async function launchChrome(sourceDir = path.join(root, "chrome"), { loadExtension = true } = {}) {
  const browser = await puppeteer.launch({
    executablePath: chromeBinary,
    headless: true,
    enableExtensions: true,
    args: ["--no-first-run", "--autoplay-policy=no-user-gesture-required"],
    defaultViewport: { width: 1000, height: 800 }
  });
  try {
    if (!loadExtension) return { browser, extensionId: null };
    const extensionId = await browser.installExtension(sourceDir);
    await browser.waitForTarget(target => target.type() === "service_worker" && target.url() === `chrome-extension://${extensionId}/background.js`);
    return { browser, extensionId };
  } catch (error) { await browser.close(); throw error; }
}
