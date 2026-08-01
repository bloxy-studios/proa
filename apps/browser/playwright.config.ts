import { defineConfig } from "@playwright/test";

/**
 * Playwright-on-Electron e2e. Runs in CI (macOS, and Linux under xvfb-run). Launches the
 * built app, drives the shell (Spaces, tabs, command palette), and captures screenshots.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"]],
  use: { trace: "retain-on-failure" },
});
