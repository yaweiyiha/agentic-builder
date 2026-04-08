import { test } from './utils';
import { expect } from '@playwright/test';

test.describe('Settings Flow', () => {
  test('should load and save user settings correctly', async ({ loggedInPage: page, baseURL }) => {
    await page.goto(`${baseURL}/settings`);

    // Assert initial settings are loaded (assuming defaults or previously saved)
    await expect(page.locator('input[name="workDuration"]')).toHaveValue('25');
    await expect(page.locator('input[name="shortBreakDuration"]')).toHaveValue('5');
    await expect(page.locator('input[name="longBreakDuration"]')).toHaveValue('15');
    await expect(page.locator('input[name="longBreakInterval"]')).toHaveValue('4');

    // Change settings
    await page.fill('input[name="workDuration"]', '30');
    await page.fill('input[name="shortBreakDuration"]', '10');
    await page.fill('input[name="longBreakDuration"]', '20');
    await page.fill('input[name="longBreakInterval"]', '3');

    // Save settings
    await page.click('button:has-text("Save Settings")');
    await expect(page.locator('text=Settings saved!')).toBeVisible();

    // Navigate away and back to ensure settings are persisted
    await page.click('nav a:has-text("Timer")');
    await page.waitForURL(`${baseURL}/timer`);
    await page.click('nav a:has-text("Settings")');
    await page.waitForURL(`${baseURL}/settings`);

    // Assert new settings are loaded
    await expect(page.locator('input[name="workDuration"]')).toHaveValue('30');
    await expect(page.locator('input[name="shortBreakDuration"]')).toHaveValue('10');
    await expect(page.locator('input[name="longBreakDuration"]')).toHaveValue('20');
    await expect(page.locator('input[name="longBreakInterval"]')).toHaveValue('3');

    // Verify the new work duration is reflected on the timer page
    await page.click('nav a:has-text("Timer")');
    await page.waitForURL(`${baseURL}/timer`);
    await expect(page.locator('div[data-testid="timer-countdown"]')).toHaveText('30:00');

    // Reset settings to default for subsequent tests if necessary
    await page.click('nav a:has-text("Settings")');
    await page.fill('input[name="workDuration"]', '25');
    await page.fill('input[name="shortBreakDuration"]', '5');
    await page.fill('input[name="longBreakDuration"]', '15');
    await page.fill('input[name="longBreakInterval"]', '4');
    await page.click('button:has-text("Save Settings")');
    await expect(page.locator('text=Settings saved!')).toBeVisible();
  });

  test('should display validation errors for invalid settings', async ({ loggedInPage: page, baseURL }) => {
    await page.goto(`${baseURL}/settings`);

    // Try to set a duration to 0
    await page.fill('input[name="workDuration"]', '0');
    await page.click('button:has-text("Save Settings")');
    await expect(page.locator('text=Duration must be greater than 0')).toBeVisible();

    // Try to set a duration to a negative number
    await page.fill('input[name="workDuration"]', '-5');
    await page.click('button:has-text("Save Settings")');
    await expect(page.locator('text=Duration must be greater than 0')).toBeVisible();
  });
});
