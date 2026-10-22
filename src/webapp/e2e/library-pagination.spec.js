import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';

const albums = Array.from({ length: 120 }, (unused, index) => ({
  albumartist: `Artist ${index + 1}`,
  album: `Album ${index + 1}`,
}));

test('the library renders and paginates one page of entries', async ({ page }) => {
  await mockBackend(page, { albums, libraryPageSize: 25 });
  await page.goto('/#/library/mpd/albums');

  const albumList = page.getByTestId('library-album-list');
  await expect(albumList.getByRole('listitem')).toHaveCount(25);
  await expect(page.getByText('Album 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Album 26', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Go to page 2' }).click();

  await expect(albumList.getByRole('listitem')).toHaveCount(25);
  await expect(page.getByText('Album 26', { exact: true })).toBeVisible();
  await expect(page.getByText('Album 1', { exact: true })).toHaveCount(0);
});

test('the page size is chosen for the device and stored', async ({ page }) => {
  await mockBackend(page, { albums, libraryPageSize: 25 });
  await page.goto('/#/library/mpd/albums');

  await expect(page.getByTestId('library-album-list').getByRole('listitem'))
    .toHaveCount(25);

  await page.getByLabel('Items per page').selectOption('50');

  await expect(page.getByTestId('library-album-list').getByRole('listitem'))
    .toHaveCount(50);
  await expect.poll(() => page.evaluate(() => (
    window.localStorage.getItem('libraryPageSize')
  ))).toBe('50');
});
