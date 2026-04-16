import { test, expect } from "@playwright/test";

/**
 * Baseline smoke test — always present in the scaffold.
 * Verifies the app loads without a blank screen or JS errors on the root route.
 * Generated E2E tests (from PRD_E2E_SPEC.md) are placed alongside this file.
 */
test("app loads without blank screen", async ({ page }) => {
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      consoleErrors.push(msg.text());
    }
  });
  page.on("pageerror", (err) => {
    consoleErrors.push(err.message);
  });

  await page.goto("/");

  const root = page.locator("#root");
  await expect(root).not.toBeEmpty({ timeout: 10_000 });

  // Filter known benign errors (e.g. missing favicon, HMR noise)
  const realErrors = consoleErrors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("[vite]") &&
      !e.includes("HMR"),
  );
  expect(realErrors, `Console errors: ${realErrors.join("\n")}`).toHaveLength(
    0,
  );
});
