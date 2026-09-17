import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';
import { expectNoHorizontalOverflow } from './layout';

const routes = [
  { name: 'player', path: '/', ready: '#player' },
  { name: 'library', path: '/#/library', ready: '#library' },
  { name: 'cards', path: '/#/cards', ready: '#cards' },
  { name: 'settings', path: '/#/settings', ready: '#settings' },
];

for (const route of routes) {
  test(`${route.name} route fits the viewport width`, async ({ page }) => {
    await mockBackend(page);
    await page.goto(route.path);
    await expect(page.locator(route.ready)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
