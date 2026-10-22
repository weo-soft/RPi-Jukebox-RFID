/*
 * The library page size is chosen per device. Until a device makes a choice,
 * the configured default from the box applies.
 */
const LIBRARY_PAGE_SIZE_KEY = 'libraryPageSize';
const LIBRARY_PAGE_SIZES = [25, 50, 100, 200, 500];
const DEFAULT_LIBRARY_PAGE_SIZE = 100;

const isLibraryPageSize = value => (
  LIBRARY_PAGE_SIZES.includes(Number(value))
);

const readLibraryPageSize = (storage = window.localStorage) => {
  try {
    const stored = storage.getItem(LIBRARY_PAGE_SIZE_KEY);
    if (isLibraryPageSize(stored)) return Number(stored);
  } catch {
    // Storage can be unavailable; the configured default applies.
  }

  return null;
};

const writeLibraryPageSize = (size, storage = window.localStorage) => {
  if (!isLibraryPageSize(size)) return;

  try {
    storage.setItem(LIBRARY_PAGE_SIZE_KEY, String(size));
  } catch {
    // Storage can be unavailable; the choice only lives for this visit.
  }
};

const resolveLibraryPageSize = (localSize, configuredSize) => {
  if (isLibraryPageSize(localSize)) return Number(localSize);
  if (isLibraryPageSize(configuredSize)) return Number(configuredSize);
  return DEFAULT_LIBRARY_PAGE_SIZE;
};

export {
  DEFAULT_LIBRARY_PAGE_SIZE,
  LIBRARY_PAGE_SIZES,
  LIBRARY_PAGE_SIZE_KEY,
  isLibraryPageSize,
  readLibraryPageSize,
  resolveLibraryPageSize,
  writeLibraryPageSize,
};
