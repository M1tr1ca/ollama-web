import { test, expect } from '@playwright/test';

test.describe('UI Verification', () => {
  test('should display the sources UI', async ({ page }) => {
    await page.goto('http://localhost:5174');

    // Enter a prompt and submit the form to trigger the search
    await page.locator('#prompt-input').fill('test');
    await page.locator('#search-toggle').check();
    await page.locator('button[type="submit"]').first().click();

    // Wait for the search process to start
    await expect(page.locator('.step-title:has-text("Searching the web")')).toBeVisible();
    await expect(page.locator('#sources-header:has-text("Revisando fuentes")')).toBeVisible({ timeout: 10000 });

    // Take a screenshot for debugging purposes
    await page.screenshot({ path: 'sources-ui-verification.png' });

    // Wait for at least one source link to be added to the DOM
    await page.waitForSelector('.source-item');
  });
});
