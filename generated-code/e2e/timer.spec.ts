import { test } from './utils';
import { expect } from '@playwright/test';

test.describe('Pomodoro Timer Flow', () => {
  test('should start, pause, resume, and reset the timer', async ({ loggedInPage: page, baseURL }) => {
    await page.goto(`${baseURL}/timer`);

    // Ensure timer is in a default state (e.g., 25:00 for work)
    await expect(page.locator('div[data-testid="timer-countdown"]')).toHaveText('25:00');
    await expect(page.locator('h2[data-testid="session-type"]')).toHaveText('Work Time');

    // Start the timer
    await page.click('button:has-text("Start")');
    await expect(page.locator('button:has-text("Pause")')).toBeVisible();
    // Wait a bit and check if time has decreased
    await page.waitForTimeout(1500); // Wait 1.5 seconds
    const timeAfterStart = await page.locator('div[data-testid="timer-countdown"]').textContent();
    expect(timeAfterStart).not.toBe('25:00');
    expect(timeAfterStart).toMatch(/24:\d{2}|25:\d{2}/); // Should be 24:59 or 24:58

    // Pause the timer
    await page.click('button:has-text("Pause")');
    await expect(page.locator('button:has-text("Resume")')).toBeVisible();
    const timeAfterPause = await page.locator('div[data-testid="timer-countdown"]').textContent();
    // Wait a bit and check if time remains the same
    await page.waitForTimeout(1500);
    const timeAfterPauseStill = await page.locator('div[data-testid="timer-countdown"]').textContent();
    expect(timeAfterPauseStill).toBe(timeAfterPause);

    // Resume the timer
    await page.click('button:has-text("Resume")');
    await expect(page.locator('button:has-text("Pause")')).toBeVisible();
    // Wait a bit and check if time has decreased again
    await page.waitForTimeout(1500);
    const timeAfterResume = await page.locator('div[data-testid="timer-countdown"]').textContent();
    expect(timeAfterResume).not.toBe(timeAfterPause);

    // Reset the timer
    await page.click('button:has-text("Reset")');
    await expect(page.locator('button:has-text("Start")')).toBeVisible();
    await expect(page.locator('div[data-testid="timer-countdown"]')).toHaveText('25:00');
  });

  test('should allow skipping a session and moving to the next type', async ({ loggedInPage: page, baseURL }) => {
    await page.goto(`${baseURL}/timer`);

    await expect(page.locator('h2[data-testid="session-type"]')).toHaveText('Work Time');
    await page.click('button:has-text("Start")'); // Start work session
    await page.waitForTimeout(500); // Let it tick for a moment

    await page.click('button:has-text("Skip")');
    await expect(page.locator('h2[data-testid="session-type"]')).toHaveText('Short Break');
    await expect(page.locator('div[data-testid="timer-countdown"]')).toHaveText('05:00'); // Default short break duration
    await expect(page.locator('button:has-text("Start")')).toBeVisible(); // Timer should be reset and ready to start next session
  });

  test('should navigate to Statistics and Settings pages', async ({ loggedInPage: page, baseURL }) => {
    await page.goto(`${baseURL}/timer`);

    // Navigate to Settings
    await page.click('nav a:has-text("Settings")');
    await page.waitForURL(`${baseURL}/settings`);
    await expect(page.locator('h1')).toHaveText('Settings');

    // Navigate back to Timer
    await page.click('nav a:has-text("Timer")');
    await page.waitForURL(`${baseURL}/timer`);
    await expect(page.locator('h2[data-testid="session-type"]')).toBeVisible();

    // Navigate to Statistics
    await page.click('nav a:has-text("Statistics")');
    await page.waitForURL(`${baseURL}/statistics`);
    await expect(page.locator('h1')).toHaveText('Statistics');
  });
});
