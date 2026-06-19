import { test, expect } from '@playwright/test';

/**
 * StyleSnap Extension Tests
 * Loads the extension from dist/ and tests core functionality.
 */

test.describe('Content Script — Floating Ball', () => {
  test('floating ball appears after page load', async ({ page }) => {
    // Open a simple HTML page
    await page.goto('data:text/html,<body><h1>Hello StyleSnap</h1></body>');

    // Wait for the floating ball to appear (content script creates it)
    const floatingBtn = page.locator('#stylesnap-floating-btn');
    await expect(floatingBtn).toBeVisible({ timeout: 5000 });
  });

  test('click floating ball activates inspect mode', async ({ page }) => {
    await page.goto('data:text/html,<body><h1>Test</h1></body>');

    const floatingBtn = page.locator('#stylesnap-floating-btn');
    await expect(floatingBtn).toBeVisible({ timeout: 5000 });

    // Click the floating ball
    await floatingBtn.click();

    // Check if inspect mode activates (button gets 'is-active' class)
    await expect(floatingBtn).toHaveClass(/is-active/);
  });
});
