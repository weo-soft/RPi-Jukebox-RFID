import {
  expect,
  test,
} from 'vitest';

import {
  DEFAULT_COLLAPSED_SECTIONS,
  readCollapsedSections,
  SETTINGS_STORAGE_KEY,
  writeCollapsedSections,
} from './collapsed-sections';

const createStorage = (initialValue = null) => {
  let value = initialValue;

  return {
    getItem: () => value,
    setItem: (_key, nextValue) => {
      value = nextValue;
    },
  };
};

test('falls back to the default sections when nothing is stored', () => {
  const storage = createStorage();

  expect(readCollapsedSections(storage)).toEqual(DEFAULT_COLLAPSED_SECTIONS);
});

test('writes the default sections when the stored entry is unreadable', () => {
  const storage = createStorage('not json');

  expect(readCollapsedSections(storage)).toEqual(DEFAULT_COLLAPSED_SECTIONS);
  expect(storage.getItem(SETTINGS_STORAGE_KEY)).toEqual(
    JSON.stringify(DEFAULT_COLLAPSED_SECTIONS),
  );
});

test('reads a stored list of section ids', () => {
  const storage = createStorage(JSON.stringify(['timers']));

  expect(readCollapsedSections(storage)).toEqual(['timers']);
});

test('ignores a stored entry that is not a list of ids', () => {
  const storage = createStorage(JSON.stringify({ timers: true }));

  expect(readCollapsedSections(storage)).toEqual(DEFAULT_COLLAPSED_SECTIONS);
});

test('round trips the collapsed sections', () => {
  const storage = createStorage();

  writeCollapsedSections(['timers', 'audio'], storage);

  expect(readCollapsedSections(storage)).toEqual(['timers', 'audio']);
});

test('keeps working when storage rejects writes', () => {
  const storage = {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota exceeded');
    },
  };

  expect(readCollapsedSections(storage)).toEqual(DEFAULT_COLLAPSED_SECTIONS);
});
