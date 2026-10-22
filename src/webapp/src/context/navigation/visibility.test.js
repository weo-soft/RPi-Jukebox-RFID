import { expect, test } from 'vitest';

import {
  NAVIGATION_VISIBLE_KEY,
  isKioskOrigin,
  navigationSeed,
  navigationVisible,
  readNavigationVisible,
  writeNavigationVisible,
} from './visibility';

const memoryStorage = () => {
  const entries = new Map();

  return {
    getItem: key => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, value),
  };
};

test('the kiosk is the loopback origin on a default port', () => {
  expect(isKioskOrigin({ hostname: 'localhost', port: '' })).toBe(true);
  expect(isKioskOrigin({ hostname: '127.0.0.1', port: '80' })).toBe(true);
  expect(isKioskOrigin({ hostname: 'phoniebox.local', port: '' })).toBe(false);
  expect(isKioskOrigin({ hostname: 'localhost', port: '4173' })).toBe(false);
});

test('the kiosk seeds hidden, every other origin starts visible', () => {
  expect(navigationSeed({ isKiosk: true, kioskSeed: false })).toBe(false);
  expect(navigationSeed({ isKiosk: true, kioskSeed: true })).toBe(true);
  expect(navigationSeed({ isKiosk: false, kioskSeed: false })).toBe(true);
});

test('the global flag overrides the local setting', () => {
  expect(navigationVisible({ globalVisible: true, localVisible: false })).toBe(true);
  expect(navigationVisible({ globalVisible: false, localVisible: false })).toBe(false);
  expect(navigationVisible({ globalVisible: false, localVisible: true })).toBe(true);
});

test('the local value round-trips and ignores unknown values', () => {
  const storage = memoryStorage();

  expect(readNavigationVisible(storage)).toBeNull();

  writeNavigationVisible(false, storage);
  expect(storage.getItem(NAVIGATION_VISIBLE_KEY)).toBe('false');
  expect(readNavigationVisible(storage)).toBe(false);

  storage.setItem(NAVIGATION_VISIBLE_KEY, 'maybe');
  expect(readNavigationVisible(storage)).toBeNull();
});
