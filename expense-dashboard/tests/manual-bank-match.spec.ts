import { test, expect } from '@playwright/test';

// Test credentials from CLAUDE.md
const TEST_EMAIL = 'pmonasterio@yahoo.com';
const TEST_PASSWORD = 'Irondoor99!!';

test.describe('Manual Bank Transaction Matching', () => {
  test.beforeEach(async ({ page }) => {
    // Navigate to the app
    await page.goto('/');

    // Wait for page to load
    await page.waitForLoadState('networkidle');

    // Check if we need to login
    const loginInput = page.locator('input[type="email"]');
    const isLoginPage = await loginInput.isVisible({ timeout: 3000 }).catch(() => false);

    if (isLoginPage) {
      console.log('Login required, filling credentials...');
      await page.fill('input[type="email"]', TEST_EMAIL);
      await page.fill('input[type="password"]', TEST_PASSWORD);
      await page.click('button[type="submit"]');

      // Wait for login to complete
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
    }
  });

  test('should match Guild Hotel expense to bank transaction', async ({ page }) => {
    // Navigate to "Needs Attention" (Review Queue)
    console.log('Clicking Needs Attention...');
    const needsAttentionButton = page.locator('button:has-text("Needs Attention")');
    await expect(needsAttentionButton).toBeVisible({ timeout: 10000 });
    await needsAttentionButton.click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(1000);

    // Click on Flagged tab
    console.log('Clicking Flagged tab...');
    const flaggedTab = page.locator('button:has-text("Flagged")');
    await expect(flaggedTab).toBeVisible({ timeout: 10000 });
    await flaggedTab.click();
    await page.waitForTimeout(1000);

    // Find and click the Guild Hotel row
    console.log('Looking for Guild Hotel...');
    const guildHotelRow = page.locator('text=Guild Hotel').first();
    await expect(guildHotelRow).toBeVisible({ timeout: 10000 });
    await guildHotelRow.click();
    await page.waitForTimeout(1000);

    // Click "Find Bank Transaction Match" button
    console.log('Clicking Find Bank Transaction Match...');
    const findMatchButton = page.locator('button:has-text("Find Bank Transaction Match")');
    await expect(findMatchButton).toBeVisible({ timeout: 10000 });
    await findMatchButton.click();
    await page.waitForTimeout(1000);

    // The modal should show transactions - find the $710.96 one and click its row
    console.log('Looking for $710.96 transaction...');
    // The amount is inside a button row - click the button that contains this amount
    const transactionButton = page.locator('button:has-text("$710.96")').first();
    await expect(transactionButton).toBeVisible({ timeout: 10000 });
    await transactionButton.click({ force: true });
    await page.waitForTimeout(500);

    // Click Confirm Match
    console.log('Clicking Confirm Match...');
    const confirmButton = page.locator('button:has-text("Confirm Match")');
    await expect(confirmButton).toBeEnabled({ timeout: 5000 });
    await confirmButton.click();
    await page.waitForTimeout(1000);

    // Verify the selected bank transaction is shown
    console.log('Verifying Manual Match Selected...');
    const selectedMatch = page.locator('text=Manual Match Selected');
    await expect(selectedMatch).toBeVisible({ timeout: 5000 });

    // Click Save & Resubmit (it says "Save & Resubmit" when hasChanges)
    console.log('Clicking Save & Resubmit...');
    const resubmitButton = page.locator('button:has-text("Save & Resubmit")');
    await expect(resubmitButton).toBeVisible({ timeout: 5000 });
    await resubmitButton.click();

    // Wait for the action to complete - the panel should close
    console.log('Waiting for action to complete...');
    await page.waitForTimeout(3000);

    // Verify success - the panel should close (no more "Manual Match Selected" visible)
    // and item should be removed from flagged list or refreshed
    const manualMatchGone = await page.locator('text=Manual Match Selected').isVisible().catch(() => false);
    expect(manualMatchGone).toBe(false);

    console.log('Test completed successfully!');
  });
});
