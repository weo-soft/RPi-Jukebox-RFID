import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';

const openPlayer = async (page, simpleMode) => {
  await page.addInitScript((value) => {
    window.localStorage.setItem('simpleMode', String(value));
  }, simpleMode);
  await mockBackend(page);
  await page.goto('/#/');
  await expect(page.getByTestId('player-cover')).toBeVisible();
};

test('simple mode disables seeking and hides shuffle, repeat and labels', async ({ page }) => {
  await openPlayer(page, true);

  const seek = page.getByRole('slider', { name: 'Current position' });
  await expect(seek).toBeVisible();
  await expect(seek).toBeDisabled();
  await expect(page.getByText('0:42', { exact: true })).toBeVisible();
  await expect(page.getByText('3:44', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable shuffle' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Enable Playlist repeat' })).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Skip to previous track' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pause' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Skip to next track' })).toBeVisible();

  await expect(page.getByText('Previous', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Next', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Shuffle', { exact: true })).toHaveCount(0);

  await expect(page.getByRole('button', { name: 'Decrease volume' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Increase volume' })).toBeVisible();

  await page.getByRole('button', { name: 'Increase volume' }).click();
  await expect(page.getByTestId('volume-feedback')).toBeVisible();
  await expect(page.getByTestId('volume-feedback')).toContainText('45 %');
});

test('regular mode keeps the full player and its labels', async ({ page }) => {
  await openPlayer(page, false);

  const seek = page.getByRole('slider', { name: 'Current position' });
  await expect(seek).toBeVisible();
  await expect(seek).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Enable shuffle' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Enable Playlist repeat' })).toBeVisible();

  await expect(page.getByText('Previous', { exact: true })).toBeVisible();
  await expect(page.getByText('Next', { exact: true })).toBeVisible();
  await expect(page.getByText('Shuffle', { exact: true })).toBeVisible();
  await expect(page.getByText('Repeat', { exact: true })).toBeVisible();
});
