import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';

test('a hidden local navigation appears after seven taps on the cover', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('navigationVisible', 'false');
  });
  await mockBackend(page);
  await page.goto('/#/');

  await expect(page.getByRole('navigation')).toHaveCount(0);

  const cover = page.getByTestId('player-cover');
  await expect(cover).toBeVisible();
  for (let tap = 0; tap < 7; tap += 1) {
    await cover.click();
  }

  await expect(page.getByRole('navigation')).toBeVisible();
  await expect.poll(() => page.evaluate(() => (
    window.localStorage.getItem('navigationVisible')
  ))).toBe('true');
});

test('the navigation stays visible on the other views', async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('navigationVisible', 'false');
  });
  await mockBackend(page);
  await page.goto('/#/settings');

  await expect(page.getByRole('navigation')).toBeVisible();
});
