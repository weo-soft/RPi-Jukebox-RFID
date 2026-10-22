import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';

test('the guard is off outside the kiosk by default', async ({ page }) => {
  await mockBackend(page);
  await page.goto('/#/');

  await expect(page.locator('html')).not.toHaveClass(/history-swipe-locked/);
});

test('the setting locks and releases the history swipe', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('preventHistorySwipe', 'true');
  });
  await mockBackend(page);
  await page.goto('/#/');

  await expect(page.locator('html')).toHaveClass(/history-swipe-locked/);
  await expect.poll(() => page.evaluate(() => (
    getComputedStyle(document.documentElement).overscrollBehaviorX
  ))).toBe('none');

  await page.goto('/#/settings');
  const toggle = page.getByRole('switch', { name: 'Prevent history swipe' });
  await expect(toggle).toBeChecked();
  await toggle.click();

  await expect(toggle).not.toBeChecked();
  await expect(page.locator('html')).not.toHaveClass(/history-swipe-locked/);
  await expect.poll(() => page.evaluate(() => (
    getComputedStyle(document.documentElement).overscrollBehaviorX
  ))).not.toBe('none');
});
