import { expect, test } from 'vitest';

import {
  DEFAULT_LIBRARY_PAGE_SIZE,
  LIBRARY_PAGE_SIZE_KEY,
  readLibraryPageSize,
  resolveLibraryPageSize,
  writeLibraryPageSize,
} from './page-size';

const memoryStorage = () => {
  const entries = new Map();

  return {
    getItem: key => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, value),
  };
};

test('a chosen page size round-trips', () => {
  const storage = memoryStorage();

  expect(readLibraryPageSize(storage)).toBeNull();

  writeLibraryPageSize(200, storage);
  expect(storage.getItem(LIBRARY_PAGE_SIZE_KEY)).toBe('200');
  expect(readLibraryPageSize(storage)).toBe(200);
});

test('an unsupported value is ignored', () => {
  const stored = memoryStorage();
  stored.setItem(LIBRARY_PAGE_SIZE_KEY, '1000');
  expect(readLibraryPageSize(stored)).toBeNull();

  const empty = memoryStorage();
  writeLibraryPageSize(1000, empty);
  expect(empty.getItem(LIBRARY_PAGE_SIZE_KEY)).toBeNull();
});

test('the local choice wins over the configured default', () => {
  expect(resolveLibraryPageSize(200, 100)).toBe(200);
  expect(resolveLibraryPageSize(null, 50)).toBe(50);
  expect(resolveLibraryPageSize(1000, 50)).toBe(50);
  expect(resolveLibraryPageSize(null, null)).toBe(DEFAULT_LIBRARY_PAGE_SIZE);
});
