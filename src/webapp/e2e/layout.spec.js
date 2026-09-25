import { expect, test } from '@playwright/test';

import { mockBackend, socketEvents } from './backend';
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
  { name: 'cards-series', path: '/#/cards/series', ready: '#cards-series' },
  { name: 'settings', path: '/#/settings', ready: '#settings' },
];

// Routes are looked up by name: adding one must not shift another test.
const routeByName = (name) => routes.find(route => route.name === name);

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

// The choice of the albums is the widest list of the series screen: groups and
// their albums have to stay inside the viewport and within reach of a finger.
test('the album choice of the series fits the viewport', async ({ page }) => {
  await openRoute(page, routeByName('cards-series'));

  await page.getByRole('button', { name: 'Choose albums' }).click();
  await expect(page.getByLabel('Group by')).toBeVisible();

  await page.getByRole('button', { name: /Daft Punk/ }).click();
  await expect(page.getByRole('button', { name: /Discovery/ })).toBeVisible();

  await expectNoHorizontalOverflow(page);
  await expectNoDeadColumns(page);
  await expectTouchTargets(page, { min: 48 });
});

test('the design tokens are applied to the document', async ({ page }) => {
  await openRoute(page, routeByName('player'));

  const touchMin = await page.evaluate(() => (
    getComputedStyle(document.documentElement).getPropertyValue('--touch-min').trim()
  ));
  expect(touchMin).not.toBe('');
});

for (const route of routes) {
  test(`${route.name} route keeps every control touch sized`, async ({ page }) => {
    await openRoute(page, route);
    await expectTouchTargets(page, { min: 48 });
  });
}

// Stacked sections make the page as tall as their sum, which is what keeps them
// lining up with each other. The sections that belong to setup start collapsed
// and the rows are compact, so the page stays around three screen fills; the
// bound keeps a pile of new sections from passing unnoticed.
const MAX_SETTINGS_FILLS = 3.5;

test('settings route keeps its length within its bound', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'kiosk');

  await openRoute(page, routeByName('settings'));

  const { content, viewport } = await page.evaluate(() => ({
    content: document.querySelector('main').getBoundingClientRect().height,
    viewport: window.innerHeight,
  }));

  expect(content / viewport).toBeLessThanOrEqual(MAX_SETTINGS_FILLS);
});

// The reference image of this route cannot hold the arrangement: the sections
// and the background are both dark, so a rearrangement stays below the colour
// distance a pixel comparison counts. The geometry carries it instead.
test('settings sections are stacked in one column', async ({ page }) => {
  await openRoute(page, routeByName('settings'));

  const sections = await page.locator('#settings > .MuiCard-root').evaluateAll(
    cards => cards.map(card => {
      const rect = card.getBoundingClientRect();
      return { left: Math.round(rect.left), top: Math.round(rect.top), width: Math.round(rect.width) };
    }),
  );

  expect(sections.length).toBeGreaterThan(1);
  // Side by side they never line up: the sections hold a different number of rows.
  expect(new Set(sections.map(({ left }) => left)).size).toBe(1);
  expect(new Set(sections.map(({ width }) => width)).size).toBe(1);
  // And they follow each other downwards.
  expect(sections.map(({ top }) => top)).toEqual([...sections.map(({ top }) => top)].sort((a, b) => a - b));
});

// A view that loads shows its state where its content will appear, centred and
// at a size that reads from the sofa, not as a speck in the corner.
test('library route centres its loading state', async ({ page }) => {
  let releaseRpc;
  const rpcGate = new Promise(resolve => {
    releaseRpc = resolve;
  });

  await mockBackend(page, { rpcGate });
  await page.goto(routeByName('library').path);
  await expect(page.locator(routeByName('library').ready)).toBeVisible();
  await expectTokensLoaded(page);

  const loading = page.getByTestId('view-loading');
  await expect(loading).toBeVisible();

  const [loadingBox, shellBox, spinnerBox] = await Promise.all([
    loading.boundingBox(),
    page.locator('#routes').boundingBox(),
    loading.locator('.MuiCircularProgress-root').boundingBox(),
  ]);

  expect(loadingBox.x + (loadingBox.width / 2))
    .toBeCloseTo(shellBox.x + (shellBox.width / 2), 0);
  expect(loadingBox.height).toBeGreaterThanOrEqual(300);
  expect(spinnerBox.width).toBeGreaterThanOrEqual(56);

  releaseRpc();
  await expect(page.getByText('Discovery', { exact: true })).toBeVisible();
});

test('player route fits the viewport without scrolling', async ({ page }) => {
  await openRoute(page, routeByName('player'));
  await expectNoScroll(page);
});

// The loading state reserves the final cover size instead of jumping when the
// cover art arrives.
test('player route keeps the cover place while the cover art loads', async ({ page }) => {
  let releaseCover;
  const coverGate = new Promise(resolve => {
    releaseCover = resolve;
  });

  await mockBackend(page, { coverGate, showCovers: true });
  await page.goto(routeByName('player').path);
  await expect(page.locator(routeByName('player').ready)).toBeVisible();
  await expectTokensLoaded(page);

  const skeleton = page.getByTestId('cover-skeleton');
  await expect(skeleton).toBeVisible();
  const pending = await skeleton.boundingBox();

  releaseCover();

  await expect(skeleton).toBeHidden();
  const cover = await page.locator('#player .MuiPaper-root').boundingBox();
  expect(cover.width).toBeCloseTo(pending.width, 0);
  expect(cover.height).toBeCloseTo(pending.height, 0);

  // The blur that costs GPU time on the panel is only worth its price with a
  // cover image behind it. It reaches past the content on every side: a blurred
  // layer that ends on the edge of the layout leaves the fraction of a device
  // pixel row that a fractional layout leaves over sharp, and the cover shows
  // through as a line at the edge.
  const blurred = page.getByTestId('player-backdrop-blur');
  await expect(blurred).toBeVisible();
  await expect(blurred).toHaveCSS('filter', 'blur(14px)');
  // One cover across the whole area, not the image repeated at its own size.
  await expect(blurred).toHaveCSS('background-repeat', 'no-repeat, no-repeat');
  await expect(blurred).toHaveCSS('background-size', '100% 100%, cover');

  const [blurBox, backdropBox] = await Promise.all([
    blurred.boundingBox(),
    page.getByTestId('player-backdrop').boundingBox(),
  ]);
  expect(blurBox.x).toBeLessThan(backdropBox.x);
  expect(blurBox.y).toBeLessThan(backdropBox.y);
  expect(blurBox.x + blurBox.width).toBeGreaterThan(backdropBox.x + backdropBox.width);
  expect(blurBox.y + blurBox.height).toBeGreaterThan(backdropBox.y + backdropBox.height);
});

// Without a song the view keeps its geometry and offers a way into the library.
test('player route offers a way to the library without a song', async ({ page }) => {
  await mockBackend(page, {
    timerEvents: {
      playerstatus: {
        ...socketEvents.playerstatus,
        songid: '',
        title: '',
      },
    },
  });
  await page.goto(routeByName('player').path);
  await expect(page.locator(routeByName('player').ready)).toBeVisible();
  await expectTokensLoaded(page);

  await expect(page.getByText('No playback')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open library' })).toBeVisible();

  // Without a cover image there is no blurred layer at all.
  await expect(page.getByTestId('player-backdrop-blur')).toHaveCount(0);

  await expectNoDeadRows(page, {
    and: '.MuiBottomNavigation-root',
    between: '[data-testid="volume-row"]',
    max: 24,
  });

  await page.getByRole('button', { name: 'Open library' }).click();
  await expect.poll(() => page.evaluate(() => window.location.hash)).toContain('/library');
});

// A view that is still loading has to sit where the loaded view sits: the
// library used to be centred while its entries were on their way and jumped to
// the top as soon as they arrived.
test('library header keeps its place while the entries load', async ({ page }) => {
  let releaseRpc;
  const rpcGate = new Promise(resolve => {
    releaseRpc = resolve;
  });

  await mockBackend(page, { rpcGate });
  await page.goto(routeByName('library').path);
  await expect(page.locator(routeByName('library').ready)).toBeVisible();
  await expectTokensLoaded(page);

  const header = page.getByRole('tab', { exact: true, name: 'Overview' });
  await expect(header).toBeVisible();
  const loading = await header.boundingBox();

  releaseRpc();
  await expect(page.getByText('Discovery', { exact: true })).toBeVisible();
  const loaded = await header.boundingBox();

  expect(loaded.y).toBeCloseTo(loading.y, 0);
});

test('player route ends right above the navigation bar', async ({ page }) => {
  await openRoute(page, routeByName('player'));
  await expectNoDeadRows(page, {
    and: '.MuiBottomNavigation-root',
    between: '[data-testid="volume-row"]',
    max: 24,
  });
});

test('player route shows title and cover in display size', async ({ page }, testInfo) => {
  await openRoute(page, routeByName('player'));

  const size = await page
    .locator('#player h5')
    .evaluate(element => parseFloat(getComputedStyle(element).fontSize));
  expect(size).toBeGreaterThanOrEqual(titleSize[testInfo.project.name]);

  const cover = await page.locator('#player .MuiPaper-root').boundingBox();
  expect(cover.width).toBeGreaterThanOrEqual(coverSize[testInfo.project.name]);
  expect(cover.height).toBeCloseTo(cover.width, 0);
});
