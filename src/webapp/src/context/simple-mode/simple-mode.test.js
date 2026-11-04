import { expect, test } from 'vitest';

import {
  SIMPLE_MODE_KEY,
  defaultSimpleMode,
  readSimpleMode,
  writeSimpleMode,
} from './simple-mode';

const memoryStorage = () => {
  const entries = new Map();

  return {
    getItem: key => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, value),
  };
};

test('the kiosk starts in simple mode and every other origin does not', () => {
  expect(defaultSimpleMode({ hostname: 'localhost', port: '' })).toBe(true);
  expect(defaultSimpleMode({ hostname: '127.0.0.1', port: '80' })).toBe(true);
  expect(defaultSimpleMode({ hostname: 'phoniebox.local', port: '' })).toBe(false);
  expect(defaultSimpleMode({ hostname: 'localhost', port: '4173' })).toBe(false);
});

test('the simple mode value round-trips', () => {
  const storage = memoryStorage();

  expect(readSimpleMode(storage)).toBeNull();

  writeSimpleMode(false, storage);
  expect(storage.getItem(SIMPLE_MODE_KEY)).toBe('false');
  expect(readSimpleMode(storage)).toBe(false);

  writeSimpleMode(true, storage);
  expect(readSimpleMode(storage)).toBe(true);
});

test('an unreadable value counts as unset', () => {
  const storage = memoryStorage();
  storage.setItem(SIMPLE_MODE_KEY, 'maybe');

  expect(readSimpleMode(storage)).toBeNull();
});
