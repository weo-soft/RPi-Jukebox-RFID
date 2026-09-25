import { expect, test } from '@playwright/test';

import { mockBackend } from './backend';

const album = (albumartist, name) => ({ albumartist, album: name });

const discovery = album('Daft Punk', 'Discovery');
const memories = album('Daft Punk', 'Random Access Memories');
const mezzanine = album('Massive Attack', 'Mezzanine');

const cardOf = (cardId, alias, args, flags = {}) => ([
  cardId,
  { from_alias: alias, action: { args }, ...flags },
]);

const rpcCallsOf = (mock, key) => (
  mock.rpcCalls.filter(({ method, plugin }) => (method || plugin) === key)
);

const openSeries = async (page, options = {}) => {
  const mock = await mockBackend(page, options);
  await page.goto('/#/cards/series');
  await expect(page.getByRole('heading', { name: 'Series' })).toBeVisible();
  return mock;
};

const startSeries = (page) => page.getByRole('button', { name: 'Start series' }).click();

test('a placed card binds the offered album without a click in between', async ({ page }) => {
  const mock = await openSeries(page, { albums: [discovery, memories], cards: {} });
  await startSeries(page);
  await expect(page.getByText('No. 1 of 2')).toBeVisible();
  await expect(page.getByText('Place a card')).toBeVisible();

  mock.publishEvent('rfid.card_id', '0001');

  await expect(page.getByText('Just bound: no. 1')).toBeVisible();
  await expect(page.getByText('No. 2 of 2')).toBeVisible();
  expect(rpcCallsOf(mock, 'register_card')).toEqual([
    expect.objectContaining({
      kwargs: {
        card_id: '0001',
        cmd_alias: 'play_album',
        args: ['Daft Punk', 'Discovery', null, 'mpd'],
        overwrite: false,
      },
    }),
  ]);
});

test('the value the broker repeats on subscription binds nothing', async ({ page }) => {
  const mock = await openSeries(page, {
    albums: [discovery, memories],
    cards: {},
    cachedCardId: '0009',
  });
  await startSeries(page);

  await expect(page.getByText('Place a card')).toBeVisible();
  expect(rpcCallsOf(mock, 'register_card')).toEqual([]);

  mock.publishEvent('rfid.card_id', '0001');

  await expect(page.getByText('Just bound: no. 1')).toBeVisible();
  expect(rpcCallsOf(mock, 'register_card')).toHaveLength(1);
});

test('a repetition of the same card counts once', async ({ page }) => {
  const mock = await openSeries(page, { albums: [discovery, memories], cards: {} });
  await startSeries(page);

  mock.publishEvent('rfid.card_id', '0001');
  await expect(page.getByText('Just bound: no. 1')).toBeVisible();
  mock.publishEvent('rfid.card_id', '0001');

  await expect(page.getByText('No. 2 of 2')).toBeVisible();
  expect(rpcCallsOf(mock, 'register_card')).toHaveLength(1);
});

test('an occupied card reports the conflict and writes nothing', async ({ page }) => {
  const mock = await openSeries(page, {
    albums: [discovery],
    cards: Object.fromEntries([
      cardOf('0001', 'play_album', ['Andere', 'Platte', null, 'mpd']),
    ]),
  });
  await startSeries(page);

  mock.publishEvent('rfid.card_id', '0001');

  await expect(page.getByText('Card 0001 is already registered with Platte')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reassign' })).toBeVisible();
  expect(rpcCallsOf(mock, 'register_card')).toEqual([]);
});

test('a card of another kind leads into the card list', async ({ page }) => {
  const mock = await openSeries(page, {
    albums: [discovery],
    cards: Object.fromEntries([
      cardOf('0001', 'shutdown', null),
    ]),
  });
  await startSeries(page);

  mock.publishEvent('rfid.card_id', '0001');

  await expect(page.getByText('Card 0001 is already registered with Shut Down')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Check in the card list' }))
    .toHaveAttribute('href', '#/cards?search=0001');
  expect(rpcCallsOf(mock, 'register_card')).toEqual([]);
});

test('the undo removes the binding of the last card', async ({ page }) => {
  const mock = await openSeries(page, { albums: [discovery, memories], cards: {} });
  await startSeries(page);
  mock.publishEvent('rfid.card_id', '0001');
  await expect(page.getByText('Just bound: no. 1')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();

  await expect(page.getByText('No. 1 of 2')).toBeVisible();
  expect(rpcCallsOf(mock, 'delete_card')).toEqual([
    expect.objectContaining({ kwargs: { card_id: '0001' } }),
  ]);
});

test('a re-hang keeps the previous entry and the undo brings it back', async ({ page }) => {
  const mock = await openSeries(page, {
    albums: [discovery],
    cards: Object.fromEntries([
      cardOf('0001', 'play_album', ['Andere', 'Platte', null, 'mpd'], { ignore_same_id_delay: true }),
    ]),
  });
  await startSeries(page);

  mock.publishEvent('rfid.card_id', '0001');
  await page.getByRole('button', { name: 'Reassign' }).click();
  await expect(page.getByText('Just bound: no. 1')).toBeVisible();

  await page.getByRole('button', { name: 'Undo' }).click();

  await expect.poll(() => rpcCallsOf(mock, 'register_card').length).toBe(2);
  expect(rpcCallsOf(mock, 'register_card')[1].kwargs).toEqual({
    card_id: '0001',
    cmd_alias: 'play_album',
    args: ['Andere', 'Platte', null, 'mpd'],
    overwrite: true,
    ignore_same_id_delay: true,
  });
});

test('a typed card id binds without a reader', async ({ page }) => {
  const mock = await openSeries(page, { albums: [discovery], cards: {} });
  await startSeries(page);

  await page.getByLabel('Card ID').fill('0002');
  await page.getByRole('button', { name: 'Bind' }).click();

  await expect(page.getByText('Just bound: no. 1')).toBeVisible();
  expect(rpcCallsOf(mock, 'register_card')).toEqual([
    expect.objectContaining({
      kwargs: expect.objectContaining({ card_id: '0002', overwrite: false }),
    }),
  ]);
});

test('the free mode binds the album that is chosen for the card', async ({ page }) => {
  const mock = await openSeries(page, { albums: [discovery, mezzanine], cards: {} });
  await page.getByLabel('Mode').selectOption('free');
  await page.getByRole('button', { name: 'Open selection' }).click();
  await expect(page.getByText('Place a card or type an id')).toBeVisible();

  mock.publishEvent('rfid.card_id', '0001');
  await expect(page.getByText('Choose an album — card 0001')).toBeVisible();

  await page.getByRole('button', { name: /Mezzanine/ }).click();

  await expect(page.getByText('Just bound: no. 2')).toBeVisible();
  expect(rpcCallsOf(mock, 'register_card')).toEqual([
    expect.objectContaining({
      kwargs: expect.objectContaining({
        card_id: '0001',
        args: ['Massive Attack', 'Mezzanine', null, 'mpd'],
      }),
    }),
  ]);
});

test('the source and the last album survive a reload', async ({ page }) => {
  const mock = await openSeries(page, { albums: [discovery, memories], cards: {} });
  await startSeries(page);
  mock.publishEvent('rfid.card_id', '0001');
  await expect(page.getByText('Just bound: no. 1')).toBeVisible();

  await page.reload();

  await expect(page.getByText('Last at no. 1.')).toBeVisible();
  await page.getByRole('button', { name: 'Continue there' }).click();
  await expect(page.getByText('Starts at no. 2 of 2.')).toBeVisible();
});

test('a source without albums points at the library', async ({ page }) => {
  await openSeries(page, { albums: [], cards: {} });

  await expect(page.getByText('This source delivers no album.')).toBeVisible();
  await expect(page.getByRole('link', { name: 'To the library' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start series' })).toBeDisabled();
});

test('a fully bound source ends the series with its count', async ({ page }) => {
  await openSeries(page, {
    albums: [discovery],
    cards: Object.fromEntries([
      cardOf('0001', 'play_album', ['Daft Punk', 'Discovery', null, 'mpd']),
    ]),
  });

  await expect(page.getByText('All 1 albums of this series have a card.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start series' })).toBeDisabled();
});

test('a missing card list is reported and binds nothing', async ({ page }) => {
  const mock = await mockBackend(page, { failRpc: true });
  await page.goto('/#/cards/series');

  await expect(page.getByText('The series could not be loaded. Without the card list nothing is bound.'))
    .toBeVisible();
  await expect(page.getByRole('button', { name: 'Load again' })).toBeVisible();

  mock.publishEvent('rfid.card_id', '0001');
  expect(rpcCallsOf(mock, 'register_card')).toEqual([]);
});

test('the series list numbers the albums and enters the session at one of them', async ({ page }) => {
  await openSeries(page, { albums: [discovery, memories, mezzanine], cards: {} });

  await page.getByRole('button', { name: 'Series list' }).click();
  await expect(page.getByText('1. Discovery')).toBeVisible();
  await expect(page.getByText('2. Mezzanine')).toBeVisible();
  await expect(page.getByText('3. Random Access Memories')).toBeVisible();

  await page.getByRole('button', { name: 'Start here' }).nth(1).click();
  await expect(page.getByText('No. 2 of 3')).toBeVisible();
});

test('a source with hundreds of albums stays usable', async ({ page }) => {
  const many = Array.from({ length: 350 }, (unused, index) => (
    album('Artist', `Album ${String(index + 1).padStart(3, '0')}`)
  ));

  await openSeries(page, { albums: many, cards: {} });
  await expect(page.getByText('Starts at no. 1 of 350.')).toBeVisible();
  await startSeries(page);
  await expect(page.getByText('No. 1 of 350')).toBeVisible();

  await page.getByRole('button', { name: 'Series list' }).click();
  await expect(page.getByText('1. Album 001')).toBeVisible();
  await expect(page.getByText('350. Album 350')).toBeVisible();

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth + 1,
  );
  expect(overflow).toBe(false);
});

test('the albums chosen by their group are the series', async ({ page }) => {
  await openSeries(page, { albums: [discovery, memories, mezzanine], cards: {} });

  await page.getByRole('button', { name: 'Choose albums' }).click();
  await expect(page.getByText('3 albums chosen, open: 3')).toBeVisible();

  await page.getByRole('checkbox', { name: 'Select Daft Punk' }).uncheck();
  await expect(page.getByText('1 album chosen, open: 1')).toBeVisible();

  await page.getByRole('button', { name: 'Back to start' }).click();
  await expect(page.getByText('1 album, open: 1')).toBeVisible();

  await startSeries(page);
  await expect(page.getByText('No. 1 of 1')).toBeVisible();
  await expect(page.getByText('Mezzanine')).toBeVisible();
});

test('the chosen albums survive a reload', async ({ page }) => {
  await openSeries(page, { albums: [discovery, memories, mezzanine], cards: {} });

  await page.getByRole('button', { name: 'Choose albums' }).click();
  await page.getByRole('checkbox', { name: 'Select Daft Punk' }).uncheck();
  await page.getByRole('button', { name: 'Back to start' }).click();

  await page.reload();

  await expect(page.getByText('1 album, open: 1')).toBeVisible();
  await startSeries(page);
  await expect(page.getByText('No. 1 of 1')).toBeVisible();
  await expect(page.getByText('Mezzanine')).toBeVisible();
});

test('a source without a chosen album points at the choice', async ({ page }) => {
  await openSeries(page, { albums: [discovery, memories], cards: {} });

  await page.getByRole('button', { name: 'Choose albums' }).click();
  await page.getByRole('checkbox', { name: 'Select Daft Punk' }).uncheck();
  await page.getByRole('button', { name: 'Back to start' }).click();

  await expect(page.getByText('The selection holds no album of this source.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start series' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Change the selection' })).toBeVisible();
});

test('the card list is searched by content and marks cards without an album', async ({ page }) => {
  await mockBackend(page, {
    cards: Object.fromEntries([
      cardOf('0001', 'play_album', ['Daft Punk', 'Discovery', null, 'mpd']),
      cardOf('0002', 'shutdown', null),
    ]),
  });
  await page.goto('/#/cards');

  await expect(page.getByText('Discovery')).toBeVisible();
  await expect(page.getByText('Not assignable')).toBeVisible();

  await page.getByLabel('Search content or card ID').fill('shutdown');

  await expect(page.getByText('Shut Down')).toBeVisible();
  await expect(page.getByText('Discovery')).toHaveCount(0);
});

test('the card list leads into the series', async ({ page }) => {
  await mockBackend(page, { albums: [discovery], cards: {} });
  await page.goto('/#/cards');

  await page.getByRole('button', { name: 'Start series' }).click();

  await expect(page.getByRole('heading', { name: 'Series' })).toBeVisible();
  await expect(page.getByText('Starts at no. 1 of 1.')).toBeVisible();
});
