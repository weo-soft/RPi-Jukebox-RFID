import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';
import {
  expectNoDeadColumns,
  expectNoHorizontalOverflow,
  expectShellFillsViewport,
} from './layout';

const routes = [
  { name: 'player', path: '/', ready: '#player' },
  { name: 'library', path: '/#/library', ready: '#library' },
  { name: 'cards', path: '/#/cards', ready: '#cards' },
  { name: 'settings', path: '/#/settings', ready: '#settings' },
];

const openRoute = async (page, route) => {
  await mockBackend(page);
  await page.goto(route.path);
  await expect(page.locator(route.ready)).toBeVisible();
};

for (const route of routes) {
  test(`${route.name} route fits the viewport width`, async ({ page }) => {
    await openRoute(page, route);
    await expectNoHorizontalOverflow(page);
  });

  test(`${route.name} route fills the shell`, async ({ page }) => {
    await openRoute(page, route);
    await expectShellFillsViewport(page);
    await expectNoDeadColumns(page);
  });
}
