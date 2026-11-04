import { expect, test } from 'vitest';

import {
  HISTORY_SWIPE_KEY,
  defaultPreventHistorySwipe,
  readPreventHistorySwipe,
  writePreventHistorySwipe,
} from './history-swipe';

const memoryStorage = () => {
  const entries = new Map();

  return {
    getItem: key => (entries.has(key) ? entries.get(key) : null),
    setItem: (key, value) => entries.set(key, value),
  };
};

test('only the kiosk disables the history swipe by default', () => {
  expect(defaultPreventHistorySwipe({ hostname: 'localhost', port: '' })).toBe(true);
  expect(defaultPreventHistorySwipe({ hostname: '127.0.0.1', port: '80' })).toBe(true);
  expect(defaultPreventHistorySwipe({ hostname: 'phoniebox.local', port: '' })).toBe(false);
  expect(defaultPreventHistorySwipe({ hostname: 'localhost', port: '4173' })).toBe(false);
});

test('the guard value round-trips', () => {
  const storage = memoryStorage();

  expect(readPreventHistorySwipe(storage)).toBeNull();

  writePreventHistorySwipe(false, storage);
  expect(storage.getItem(HISTORY_SWIPE_KEY)).toBe('false');
  expect(readPreventHistorySwipe(storage)).toBe(false);

  writePreventHistorySwipe(true, storage);
  expect(readPreventHistorySwipe(storage)).toBe(true);
});

test('an unreadable value counts as unset', () => {
  const storage = memoryStorage();
  storage.setItem(HISTORY_SWIPE_KEY, 'maybe');

  expect(readPreventHistorySwipe(storage)).toBeNull();
});
