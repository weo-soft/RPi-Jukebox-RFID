import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';

const STORAGE_KEY = 'settingsCollapsedSections';

const openSettings = async (page) => {
  await mockBackend(page);
  await page.goto('/#/settings');
  await expect(page.locator('#settings')).toBeVisible();
};

test('settings sections start in the documented state', async ({ page }) => {
  await openSettings(page);

  const section = (name) => page.getByRole('button', { exact: true, name });

  await expect(section('System')).toHaveAttribute('aria-expanded', 'true');
  await expect(section('Timers')).toHaveAttribute('aria-expanded', 'true');
  await expect(section('System Controls')).toHaveAttribute('aria-expanded', 'false');
  await expect(section('Second Swipe')).toHaveAttribute('aria-expanded', 'false');
  await expect(section('Auto Hotspot')).toHaveAttribute('aria-expanded', 'false');
});

test('a collapsed section keeps its state across a reload', async ({ page }) => {
  await openSettings(page);

  const general = page.getByRole('button', { name: 'General Settings' });
  await expect(general).toHaveAttribute('aria-expanded', 'true');
  await expect(page.getByText('Show Cover Art')).toBeVisible();

  await general.click();

  await expect(general).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Show Cover Art')).toBeHidden();
  await expect.poll(() => page.evaluate(key => (
    window.localStorage.getItem(key)
  ), STORAGE_KEY)).toContain('general');

  await page.reload();

  await expect(
    page.getByRole('button', { name: 'General Settings' }),
  ).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByText('Show Cover Art')).toBeHidden();
});
