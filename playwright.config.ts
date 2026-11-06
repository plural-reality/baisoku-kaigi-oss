import { defineConfig, devices } from "@playwright/test";

const isCI = !!process.env.CI;
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";
const startsLocalServer =
  baseURL.startsWith("http://localhost") ||
  baseURL.startsWith("http://127.0.0.1");
const chromiumUse =
  process.env.PLAYWRIGHT_BROWSER_CHANNEL === "chrome"
    ? { ...devices["Desktop Chrome"], channel: "chrome" as const }
    : { ...devices["Desktop Chrome"] };

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  forbidOnly: isCI,
  retries: isCI ? 2 : 0,
  workers: isCI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL,
    trace: "on-first-retry",
  },

  projects: isCI
    ? [
        {
          name: "chromium",
          use: chromiumUse,
        },
      ]
    : [
        {
          name: "chromium",
          use: chromiumUse,
        },

        {
          name: "firefox",
          use: { ...devices["Desktop Firefox"] },
        },

        {
          name: "webkit",
          use: { ...devices["Desktop Safari"] },
        },
      ],

  webServer: startsLocalServer
    ? {
        command: "npm run dev",
        url: baseURL,
        reuseExistingServer: !isCI,
        timeout: 120_000,
      }
    : undefined,
});
