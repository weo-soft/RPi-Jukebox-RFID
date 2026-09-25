import { expect, test } from 'vitest';

import {
  SERIES_MEMORY_KEY,
  memoryPosition,
  readSeriesMemory,
  writeSeriesMemory,
} from './series-memory';


const fakeStorage = (initial = {}) => {
  const entries = new Map(Object.entries(initial));

  return {
    getItem: key => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, value),
    entries,
  };
};

const albumKey = '["mpd","Benjamin Blümchen","Folge 37",null]';

const selection = {
  albumKeys: [albumKey, '["mpd","Die Ärzte","Jazz ist anders",null]'],
  groupingId: 'albumartist',
};

const memory = {
  source: 'mpd',
  order: 'album-natural',
  albumKey,
  selection: null,
};

test('source, order and album key are written and read together', () => {
  const storage = fakeStorage();

  writeSeriesMemory(memory, storage);

  expect(JSON.parse(storage.entries.get(SERIES_MEMORY_KEY))).toEqual(memory);
  expect(readSeriesMemory(storage)).toEqual(memory);
});

test('the chosen albums are read back with the start point', () => {
  const storage = fakeStorage();
  const withSelection = { ...memory, selection };

  writeSeriesMemory(withSelection, storage);

  expect(readSeriesMemory(storage)).toEqual(withSelection);
});

test('a series that only chose its albums keeps the choice and no start point', () => {
  const storage = fakeStorage({
    [SERIES_MEMORY_KEY]: JSON.stringify({ source: 'mpd', order: 'album-natural', selection }),
  });

  expect(readSeriesMemory(storage)).toEqual({
    source: 'mpd',
    order: 'album-natural',
    albumKey: '',
    selection,
  });
});

test('a missing entry is no memory', () => {
  expect(readSeriesMemory(fakeStorage())).toBeNull();
});

test('an unreadable or foreign entry falls back to no memory', () => {
  expect(readSeriesMemory(fakeStorage({ [SERIES_MEMORY_KEY]: '{' }))).toBeNull();
  expect(readSeriesMemory(fakeStorage({ [SERIES_MEMORY_KEY]: '"mpd"' }))).toBeNull();
  expect(readSeriesMemory(fakeStorage({
    [SERIES_MEMORY_KEY]: JSON.stringify({ source: 'mpd' }),
  }))).toBeNull();
  expect(readSeriesMemory(fakeStorage({
    [SERIES_MEMORY_KEY]: JSON.stringify({ order: 'album-natural' }),
  }))).toBeNull();
});

test('a selection the reader cannot use falls back to the whole source', () => {
  const foreign = (value) => readSeriesMemory(fakeStorage({
    [SERIES_MEMORY_KEY]: JSON.stringify({ ...memory, selection: value }),
  }));

  expect(foreign('all').selection).toBeNull();
  expect(foreign({ groupingId: 'albumartist' }).selection).toBeNull();
  expect(foreign({ albumKeys: [albumKey] }).selection).toBeNull();
  expect(foreign({ albumKeys: [null], groupingId: 'albumartist' }).selection).toBeNull();
  expect(foreign({ albumKeys: 'all', groupingId: 'albumartist' }).selection).toBeNull();
  expect(foreign(undefined).selection).toBeNull();
  expect(foreign(undefined).albumKey).toBe(albumKey);
});

test('storage that refuses to write leaves the series without a start point', () => {
  const storage = {
    getItem: () => null,
    setItem: () => { throw new Error('denied'); },
  };

  expect(() => writeSeriesMemory(memory, storage)).not.toThrow();
});

test('the remembered album is resolved against the current order', () => {
  const queue = [
    { key: '["mpd","Die Ärzte","Jazz ist anders",null]' },
    { key: memory.albumKey },
  ];

  expect(memoryPosition(queue, memory)).toBe(1);
  expect(memoryPosition(queue, { ...memory, albumKey: '["mpd","Nobody","Nothing",null]' })).toBe(-1);
  expect(memoryPosition(queue, { ...memory, albumKey: '' })).toBe(-1);
  expect(memoryPosition(queue, null)).toBe(-1);
});
