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

const memory = {
  source: 'mpd',
  order: 'album-natural',
  albumKey: '["mpd","Benjamin Blümchen","Folge 37",null]',
};

test('source, order and album key are written and read together', () => {
  const storage = fakeStorage();

  writeSeriesMemory(memory, storage);

  expect(JSON.parse(storage.entries.get(SERIES_MEMORY_KEY))).toEqual(memory);
  expect(readSeriesMemory(storage)).toEqual(memory);
});

test('a missing entry is no memory', () => {
  expect(readSeriesMemory(fakeStorage())).toBeNull();
});

test('an unreadable or foreign entry falls back to no memory', () => {
  expect(readSeriesMemory(fakeStorage({ [SERIES_MEMORY_KEY]: '{' }))).toBeNull();
  expect(readSeriesMemory(fakeStorage({ [SERIES_MEMORY_KEY]: '"mpd"' }))).toBeNull();
  expect(readSeriesMemory(fakeStorage({
    [SERIES_MEMORY_KEY]: JSON.stringify({ source: 'mpd', order: 'album-natural' }),
  }))).toBeNull();
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
  expect(memoryPosition(queue, null)).toBe(-1);
});
