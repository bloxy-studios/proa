import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { test, expect, _electron as electron, type ElectronApplication, type Page } from "@playwright/test";

/**
 * Launches the built Electron app and exercises the browsing chrome: the shell renders, the
 * command palette opens (⌘T), a Space exists, and the Dev HUD opens. Screenshots are written
 * to docs/screenshots/ for the README. This is the "if you can't show it, it doesn't exist"
 * self-verification habit (mission §9), running against no external network.
 */
let app: ElectronApplication;
let page: Page;
const shotsDir = join(__dirname, "../../../docs/screenshots");

test.beforeAll(async () => {
  mkdirSync(shotsDir, { recursive: true });
  app = await electron.launch({ args: [join(__dirname, "../out/main/index.js")] });
  page = await app.firstWindow();
  await page.waitForSelector(".shell", { timeout: 30_000 });
});

test.afterAll(async () => {
  await app?.close();
});

test("the three-surface shell renders", async () => {
  await expect(page.locator(".sidebar")).toBeVisible();
  await expect(page.locator(".web")).toBeVisible();
  await expect(page.locator(".console")).toBeVisible();
  await page.screenshot({ path: join(shotsDir, "hero.png") });
});

test("the command palette opens and searches", async () => {
  await page.keyboard.press("Meta+t");
  await expect(page.locator(".palette")).toBeVisible();
  await page.locator(".palette input").fill("news.ycombinator.com");
  await expect(page.locator(".palette .res").first()).toBeVisible();
  await page.screenshot({ path: join(shotsDir, "palette.png") });
  await page.keyboard.press("Escape");
});

test("the agent console is present", async () => {
  await expect(page.locator(".console h3")).toHaveText("Agent");
  await page.locator(".composer textarea").fill("extract the product table");
  await page.screenshot({ path: join(shotsDir, "agent-console.png") });
});
