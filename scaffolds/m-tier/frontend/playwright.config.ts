import { defineConfig, devices } from "@playwright/test";

// CRITICAL — DO NOT EDIT THE `webServer` ARRAY UNLESS YOU READ THIS NOTE.
//
// `webServer` MUST stay an ARRAY that starts BOTH the backend (on :4000) and
// the frontend (on :5173). The frontend Vite dev server proxies `/api/*` to
// `http://localhost:4000`, so any test that touches an API endpoint will fail
// with `ECONNREFUSED` if the backend is not running. Collapsing this into a
// single object (frontend-only) is the single most common cause of E2E
// `infra` failures in this project — the supervisor will auto-rewrite the
// config back to the array form if it detects this regression.
//
// Allowed edits:
// - tweak `timeout`, `retries`, `reporter`, `projects`, `use.*`
// - add a third entry to `webServer` if you really need another service
// Disallowed edits:
// - replacing the array with a single object
// - removing the backend entry
// - changing the backend health URL away from `/api/health`
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "line",
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  webServer: [
    {
      command: "cd ../backend && pnpm dev",
      url: "http://localhost:4000/api/health",
      reuseExistingServer: true,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "pnpm dev",
      url: "http://localhost:5173",
      reuseExistingServer: true,
      timeout: 60_000,
    },
  ],
});
