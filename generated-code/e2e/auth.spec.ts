import { test, generateUniqueEmail, TEST_PASSWORD } from './utils';
import { expect } from '@playwright/test';

test.describe('Authentication Flow', () => {
  const uniqueEmail = generateUniqueEmail();
  const password = TEST_PASSWORD;

  test('should allow a new user to register and redirect to timer page', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/register`);

    await page.fill('input[name="email"]', uniqueEmail);
    await page.fill('input[name="password"]', password);
    await page.fill('input[name="confirmPassword"]', password);

    await page.click('button:has-text("Register")');

    await page.waitForURL(`${baseURL}/timer`);
    await expect(page.locator('h2')).toHaveText(/Work Time|Short Break|Long Break/);
    await expect(page.locator('nav a:has-text("Logout")')).toBeVisible();
  });

  test('should allow an existing user to log in and redirect to timer page', async ({ page, baseURL }) => {
    // Ensure the user is registered from the previous test or a setup step
    // For independent tests, you'd register here or use a fixture.
    // For this example, we assume the user from the previous test exists.
    await page.goto(`${baseURL}/login`);

    await page.fill('input[name="email"]', uniqueEmail);
    await page.fill('input[name="password"]', password);

    await page.click('button:has-text("Login")');

    await page.waitForURL(`${baseURL}/timer`);
    await expect(page.locator('h2')).toHaveText(/Work Time|Short Break|Long Break/);
    await expect(page.locator('nav a:has-text("Logout")')).toBeVisible();
  });

  test('should display an error for invalid login credentials', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/login`);

    await page.fill('input[name="email"]', 'nonexistent@example.com');
    await page.fill('input[name="password"]', 'wrongpassword');

    await page.click('button:has-text("Login")');

    await expect(page.locator('text=Invalid credentials')).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}/login`); // Should stay on login page
  });

  test('should allow a logged-in user to log out and redirect to login page', async ({ loggedInPage: page, baseURL }) => {
    // The loggedInPage fixture ensures we start logged in
    await expect(page.locator('nav a:has-text("Logout")')).toBeVisible();

    await page.click('nav a:has-text("Logout")');

    await page.waitForURL(`${baseURL}/login`);
    await expect(page.locator('h1')).toHaveText('Login');
    await expect(page.locator('nav a:has-text("Logout")')).not.toBeVisible();
  });

  test('should display an error for registration with an existing email', async ({ page, baseURL }) => {
    await page.goto(`${baseURL}/register`);

    await page.fill('input[name="email"]', uniqueEmail); // Use the already registered email
    await page.fill('input[name="password"]', password);
    await page.fill('input[name="confirmPassword"]', password);

    await page.click('button:has-text("Register")');

    await expect(page.locator('text=Email already exists')).toBeVisible();
    await expect(page).toHaveURL(`${baseURL}/register`); // Should stay on register page
  });
});
