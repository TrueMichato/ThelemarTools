import {chromium} from "@playwright/test";

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 816, height: 1056}});
// Dismiss any print dialogs before navigation
page.on("dialog", async (dialog) => { await dialog.dismiss(); });
await page.goto("file:///tmp/charsheet-preview.html", {waitUntil: "networkidle"});
await page.waitForTimeout(800);
await page.screenshot({path: "/tmp/charsheet-screenshot.png", fullPage: true});
console.log("Screenshot saved");
await browser.close();
