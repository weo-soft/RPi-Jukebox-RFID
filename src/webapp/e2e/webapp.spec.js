import { expect, test } from '@playwright/test';

import { mockBackend, socketEvents } from './backend';
import { expectShellFillsViewport } from './layout';

async function expectStableLayout(page) {
  await expect(page.locator('#root')).not.toBeEmpty();
  await expect(page.locator('.MuiBottomNavigation-root')).toBeVisible();

  const layout = await page.evaluate(() => {
    const actions = Array.from(
      document.querySelectorAll('.MuiBottomNavigationAction-root'),
      element => element.getBoundingClientRect(),
    );
    const nav = document.querySelector('.MuiBottomNavigation-root')
      .getBoundingClientRect();
    const actionRows = Array.from(document.querySelectorAll('.MuiListItem-root'));

    return {
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth,
      navWithinViewport: nav.top >= 0 && nav.bottom <= window.innerHeight + 1,
      overlappingContentActions: actionRows.some(row => {
        const text = row.querySelector('.MuiListItemText-root');
        const action = row.querySelector(
          '.MuiButton-root, .MuiIconButton-root, .MuiSwitch-root',
        );
        if (!text || !action) {
          return false;
        }

        const textRect = text.getBoundingClientRect();
        const actionRect = action.getBoundingClientRect();
        return (
          textRect.left < actionRect.right &&
          textRect.right > actionRect.left &&
          textRect.top < actionRect.bottom &&
          textRect.bottom > actionRect.top
        );
      }),
      overlappingActions: actions.some((action, index) => (
        actions.slice(index + 1).some(other => (
          action.left < other.right &&
          action.right > other.left &&
          action.top < other.bottom &&
          action.bottom > other.top
        ))
      )),
    };
  });

  expect(layout).toEqual({
    horizontalOverflow: false,
    navWithinViewport: true,
    overlappingContentActions: false,
    overlappingActions: false,
  });
}

async function expectAbove(top, bottom) {
  const [topBox, bottomBox] = await Promise.all([
    top.boundingBox(),
    bottom.boundingBox(),
  ]);

  expect(topBox.y + topBox.height).toBeLessThanOrEqual(bottomBox.y);
}

// A reference image is comparable only once every image of the page has
// finished loading: a placeholder that arrives late changes the pixels below
// it, and a loaded machine delivers it later than a warm development server.
async function expectImagesLoaded(page) {
  await expect.poll(() => page.evaluate(() => (
    Array.from(document.images).every(image => image.complete)
  ))).toBe(true);
}

function collectConsoleErrors(page) {
  const errors = [];
  page.on('console', message => {
    if (message.type() === 'error') {
      errors.push(message.text());
    }
  });
  return errors;
}

const routes = [
  {
    name: 'player',
    path: '/',
    ready: '#player',
    text: 'One More Time',
  },
  {
    name: 'library',
    path: '/#/library',
    ready: '#library',
    text: 'Discovery',
  },
  {
    name: 'cards',
    path: '/#/cards',
    ready: '#cards',
    text: '0001234567',
  },
  {
    name: 'settings',
    path: '/#/settings',
    ready: '#settings',
    text: '192.168.1.42',
  },
];

for (const route of routes) {
  test(`${route.name} route renders`, async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await mockBackend(page);
    await page.goto(route.path);
    await expect(page.locator(route.ready)).toBeVisible();
    await expect(page.getByText(route.text, { exact: false }).first()).toBeVisible();
    await expectStableLayout(page);
    if (route.name === 'library') {
      await expectAbove(
        page.getByRole('tab', { name: 'Overview' }),
        page.getByText('Discovery', { exact: true }),
      );
    }
    if (route.name === 'cards') {
      await expectAbove(
        page.getByRole('heading', { name: 'Cards' }),
        page.getByText('0001234567', { exact: true }),
      );
    }
    await expectImagesLoaded(page);
    await expect(page).toHaveScreenshot(`${route.name}.png`);
    expect(consoleErrors).toEqual([]);
  });
}

test('bottom navigation changes routes', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await mockBackend(page);
  await page.goto('/');

  await page.getByRole('link', { name: 'Library' }).click();
  await expect(page).toHaveURL(/#\/library\/overview$/);

  await page.getByRole('link', { name: 'Cards' }).click();
  await expect(page).toHaveURL(/#\/cards$/);

  await page.getByRole('link', { name: 'Settings' }).click();
  await expect(page).toHaveURL(/#\/settings$/);
  expect(consoleErrors).toEqual([]);
});

// The reference image stays without cover art on purpose: a cover turns the
// backdrop into a blurred, scaled copy of the image, and how a machine
// rasterises that is not reproducible. The backdrop rules themselves are
// checked in e2e/layout.spec.js.
test('player backdrop covers its full width across the md breakpoint', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop');
  const consoleErrors = collectConsoleErrors(page);
  await page.setViewportSize({ width: 800, height: 800 });
  await mockBackend(page);
  await page.goto('/');

  await expect(page.locator('#player img')).toHaveAttribute('src', /noCover/);
  for (const width of [800, 899, 900, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await expectShellFillsViewport(page);
    const [mainBox, backdropBox] = await Promise.all([
      page.locator('main').boundingBox(),
      page.getByTestId('player-backdrop').boundingBox(),
    ]);

    expect(backdropBox.x).toBeCloseTo(mainBox.x, 0);
    expect(backdropBox.width).toBeCloseTo(mainBox.width, 0);
  }

  await page.setViewportSize({ width: 899, height: 800 });
  await expectImagesLoaded(page);
  await expect(page).toHaveScreenshot('player-899.png');
  expect(consoleErrors).toEqual([]);
});

// Long German titles and missing provider covers are the normal case on a box.
// The check reads the geometry instead of comparing pixels: how many lines a
// title takes follows the metrics of the font the system resolves, so the same
// page renders a line taller or shorter on another machine.
test('player route renders a long title without a cover', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await mockBackend(page, {
    timerEvents: {
      playerstatus: {
        ...socketEvents.playerstatus,
        album: 'Benjamin Blümchen, Folge 1: … als Wetterelefant',
        artist: 'Benjamin Blümchen',
        title: 'Ein Elefant will hoch hinaus',
      },
    },
  });
  await page.goto('/');

  const title = page.locator('#player h5');
  await expect(title).toHaveText('Ein Elefant will hoch hinaus');

  const lines = await title.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      clamp: Number(style.webkitLineClamp),
      height: element.clientHeight,
      lineHeight: parseFloat(style.lineHeight),
    };
  });
  // The title breaks into at most two lines and never spills out of its box.
  expect(lines.clamp).toBe(2);
  expect(lines.height).toBeLessThanOrEqual((2 * lines.lineHeight) + 1);

  const subtitle = page.locator('#player h5 + *');
  const subtitleLines = await subtitle.evaluate(element => {
    const style = getComputedStyle(element);
    return {
      height: element.clientHeight,
      lineHeight: parseFloat(style.lineHeight),
      overflow: style.textOverflow,
      whiteSpace: style.whiteSpace,
    };
  });
  // The subtitle stays on one line and is cut with an ellipsis.
  expect(subtitleLines.whiteSpace).toBe('nowrap');
  expect(subtitleLines.overflow).toBe('ellipsis');
  expect(subtitleLines.height).toBeLessThanOrEqual(subtitleLines.lineHeight + 1);

  // A missing cover falls back to the shipped replacement image.
  const cover = page.locator('#player .MuiPaper-root');
  await expect(cover.locator('img')).toHaveAttribute('src', /noCover/);
  await expect.poll(() => cover.locator('img').evaluate(
    image => image.naturalWidth,
  )).toBeGreaterThan(0);

  const coverBox = await cover.boundingBox();
  expect(coverBox.height).toBeCloseTo(coverBox.width, 0);

  await expectStableLayout(page);
  expect(consoleErrors).toEqual([]);
});

test('encoded library folder routes preserve the folder path', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  const { libraryCalls } = await mockBackend(page);
  await page.goto('/#/library/folders/Music%2FRock');

  await expect.poll(() => libraryCalls).toContain('Music/Rock');
  await expect(page).toHaveURL(/#\/library\/mpd\/folders\/Music%2FRock$/);
  await expect(page.getByRole('link', { name: 'Library' })).toHaveClass(/Mui-selected/);
  await expect(page.getByText('sample.mp3')).toBeVisible();
  await expectStableLayout(page);
  expect(consoleErrors).toEqual([]);
});

test('local library tabs replace the current nested route', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  await mockBackend(page);
  await page.goto('/#/library/mpd/folders/Music%2FRock?cardId=123');

  await page.getByRole('tab', { name: 'Albums' }).click();

  await expect(page).toHaveURL(/#\/library\/mpd\/albums\?cardId=123$/);
  await expect(page.getByText('Discovery', { exact: true })).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('library playback preserves provider and content URI', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  const { rpcCalls } = await mockBackend(page, { streamingLibrary: true });
  await page.goto('/#/library');

  await expect(
    page.getByRole('heading', { name: 'Streaming Playlists' }),
  ).toBeVisible();
  await page.getByRole('tab', { name: 'Streaming' }).click();
  await expect(page).toHaveURL(/#\/library\/streaming\/playlists$/);

  await page.getByText('Bedtime Stories', { exact: true }).click();
  await expect(page.getByText('Chapter One', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Play' }).click();

  await expect.poll(() => (
    rpcCalls.find(call => call.method === 'play_album')?.kwargs
  )).toEqual({
    album: 'Bedtime Stories',
    albumartist: 'Family',
    content_uri: 'service:playlist:bedtime',
    provider: 'streaming',
  });
  expect(consoleErrors).toEqual([]);
});

test('cards route shows its loading state while RPC is pending', async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  let releaseRpc;
  const rpcGate = new Promise(resolve => {
    releaseRpc = resolve;
  });

  await mockBackend(page, { rpcGate });
  await page.goto('/#/cards');

  await expect(page.getByRole('progressbar')).toBeVisible();
  releaseRpc();
  await expect(page.getByText('0001234567')).toBeVisible();
  expect(consoleErrors).toEqual([]);
});

test('RPC failures leave navigation and an error state available', async ({ page }) => {
  await mockBackend(page, { failRpc: true });
  await page.goto('/#/cards');

  await expect(page.getByText('An error occurred while loading cards list.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Settings' })).toBeVisible();
  await expectStableLayout(page);
});

test('timer settings follow authoritative backend state', async ({ page }) => {
  const timerTopic = 'timers.timer_shutdown';
  const {
    publishEvent,
    rpcCalls,
    subscribedTopics,
  } = await mockBackend(page);
  await page.goto('/#/settings');

  const shutdownTimer = page.getByRole('listitem').filter({
    has: page.getByText('Shut Down', { exact: true }),
  });
  await expect.poll(() => Array.from(subscribedTopics)).toContain(timerTopic);
  publishEvent(timerTopic, {
    enabled: true,
    remaining_seconds: 3600,
  });
  await expect(page.getByText('1:00:00')).toBeVisible();
  await shutdownTimer.getByRole('button', { name: 'Cancel' }).click();
  await expect(
    shutdownTimer.getByRole('button', { name: 'Set timer' }),
  ).toBeVisible();
  await expect.poll(() => (
    rpcCalls.filter(call => (
      call.plugin === 'timer_shutdown' && call.method === 'cancel'
    )).length
  )).toBe(1);

  publishEvent(timerTopic, {
    enabled: true,
    remaining_seconds: 7200,
  });
  await expect(page.getByText('2:00:00')).toBeVisible();

  publishEvent(timerTopic, {
    enabled: false,
    remaining_seconds: 0,
  });
  const setTimer = shutdownTimer.getByRole('button', { name: 'Set timer' });
  await expect(setTimer).toBeVisible();
  await setTimer.click();
  const slider = page.getByRole('slider');
  await slider.press('ArrowRight');
  await slider.press('ArrowRight');
  await page.getByRole('button', { name: 'Start timer' }).click();

  await expect.poll(() => (
    rpcCalls.filter(call => (
      call.plugin === 'timer_shutdown' && call.method === 'start'
    ))
  )).toHaveLength(1);
  const [startCall] = rpcCalls.filter(call => (
    call.plugin === 'timer_shutdown' && call.method === 'start'
  ));
  expect(startCall.kwargs).toEqual({ wait_seconds: 300 });
  expect(rpcCalls.filter(call => (
    call.plugin === 'timer_shutdown' && call.method === 'cancel'
  ))).toHaveLength(1);
});
