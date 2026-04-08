import { test as base } from '@playwright/test';
import type { Page, BrowserContext } from '@playwright/test'; // Import Page type

export function generateUniqueEmail(): string {
  const timestamp = Date.now();
  return `testuser_${timestamp}@example.com`;
}

export const TEST_PASSWORD = 'Password123!';

// Extend the base test to include a login fixture
type MyFixtures = {
  loggedInPage: Page; // Type as Page from Playwright
  userEmail: string;
  userPassword: string;
};

export const test = base.extend<MyFixtures>({
  userEmail: async ({}, use: (arg: string) => Promise<void>) => {
    await use(generateUniqueEmail());
  },
  userPassword: async ({}, use: (arg: string) => Promise<void>) => {
    await use(TEST_PASSWORD);
  },
  loggedInPage: async ({ page, baseURL, userEmail, userPassword }, use: (arg: Page) => Promise<void>) => {
    // Register the user first
    await page.goto(`${baseURL}/register`);
    await page.fill('input[name="email"]', userEmail);
    await page.fill('input[name="password"]', userPassword);
    await page.fill('input[name="confirmPassword"]', userPassword);
    await page.click('button:has-text("Register")');
    await page.waitForURL(`${baseURL}/timer`);

    // Ensure we are logged in
    await page.waitForSelector('nav a:has-text("Logout")');

    await use(page);

    // No explicit logout needed for this fixture, as the context will be torn down.
    // If cleanup of the user in the DB was required, it would go here.
  },
});
