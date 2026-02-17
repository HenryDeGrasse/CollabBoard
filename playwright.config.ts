import { defineConfig, devices } from "@playwright/test";

const USE_EMULATORS = process.env.USE_EMULATORS !== "false";
const BASE_URL = process.env.TEST_BASE_URL || "http://localhost:5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true, // Each test uses its own boardId — safe to parallelize
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : 4, // 4 parallel workers locally
  reporter: [["html", { open: "never" }], ["list"]],
  timeout: 60_000,

  use: {
    baseURL: BASE_URL,
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  projects: [
    {
      name: "e2e",
      testMatch: /.*\.spec\.ts$/,
      testIgnore: /stress/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "stress",
      testMatch: /.*stress.*\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
      timeout: 120_000,
    },
  ],

  // Auto-start dev server for local testing
  webServer: USE_EMULATORS
    ? {
        command: "npm run dev -- --mode emulator --port 5173",
        port: 5173,
        reuseExistingServer: true,
        timeout: 15_000,
      }
    : undefined,
});
