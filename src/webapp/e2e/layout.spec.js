import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';
import {
  expectNoDeadColumns,
  expectNoDeadRows,
  expectNoHorizontalOverflow,
  expectNoScroll,
  expectShellFillsViewport,
  expectTokensLoaded,
  expectTouchTargets,
} from './layout';

const routes = [
  { name: 'player', path: '/', ready: '#player' },
  { name: 'library', path: '/#/library', ready: '#library' },
  { name: 'cards', path: '/#/cards', ready: '#cards' },
  { name: 'settings', path: '/#/settings', ready: '#settings' },
];

// The narrow tier is limited by the column width, so its square stays smaller.
const coverSize = {
  desktop: 380,
  kiosk: 380,
  mobile: 320,
};

// The type scale ends at 24 px on a narrow viewport and at 42 px on the panel.
const titleSize = {
  desktop: 40,
  kiosk: 40,
  mobile: 24,
};

const openRoute = async (page, route) => {
  await mockBackend(page);
  await page.goto(route.path);
  await expect(page.locator(route.ready)).toBeVisible();
  await expectTokensLoaded(page);
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

test('the design tokens are applied to the document', async ({ page }) => {
  await openRoute(page, routes[0]);

  const touchMin = await page.evaluate(() => (
    getComputedStyle(document.documentElement).getPropertyValue('--touch-min').trim()
  ));
  expect(touchMin).not.toBe('');
});

test('player route keeps every control touch sized', async ({ page }) => {
  await openRoute(page, routes[0]);
  await expectTouchTargets(page, { min: 48 });
});

test('player route fits the viewport without scrolling', async ({ page }) => {
  await openRoute(page, routes[0]);
  await expectNoScroll(page);
});

test('player route ends right above the navigation bar', async ({ page }) => {
  await openRoute(page, routes[0]);
  await expectNoDeadRows(page, {
    and: '.MuiBottomNavigation-root',
    between: '[data-testid="volume-row"]',
    max: 24,
  });
});

test('player route shows title and cover in display size', async ({ page }, testInfo) => {
  await openRoute(page, routes[0]);

  const size = await page
    .locator('#player h5')
    .evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(size).toBeGreaterThanOrEqual(titleSize[testInfo.project.name]);

  const cover = await page.locator('#player .MuiPaper-root').boundingBox();
  expect(cover.width).toBeGreaterThanOrEqual(coverSize[testInfo.project.name]);
  expect(cover.height).toBeCloseTo(cover.width, 0);
});
