import { test, expect } from '@playwright/test';

test.describe('Simple UI Verification', () => {
  test('should just take a screenshot', async ({ page }) => {
    await page.goto('http://localhost:5174');
    await page.waitForTimeout(5000); // Wait for 5 seconds
    await page.screenshot({ path: 'simple-test-screenshot.png' });
  });
});
