/*
 * The collapsed state of the settings sections lives in the browser, so it
 * survives a route change, a reload and a restart of the kiosk browser.
 */
export const SETTINGS_STORAGE_KEY = 'settingsCollapsedSections';

// Everyday functions stay open; setup and maintenance start collapsed.
export const DEFAULT_COLLAPSED_SECTIONS = [
  'system-controls',
  'second-swipe',
  'auto-hotspot',
];

const isSectionIdList = (value) => (
  Array.isArray(value) && value.every(entry => typeof entry === 'string')
);

export const writeCollapsedSections = (sectionIds, storage = window.localStorage) => {
  try {
    storage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(sectionIds));
  } catch {
    // Storage can be unavailable; the sections are then only open or closed
    // for the current visit.
  }
};

export const readCollapsedSections = (storage = window.localStorage) => {
  try {
    const stored = storage.getItem(SETTINGS_STORAGE_KEY);
    if (stored !== null) {
      const parsed = JSON.parse(stored);
      if (isSectionIdList(parsed)) return parsed;
    }
  } catch {
    // An unreadable entry is replaced by the defaults below.
  }

  writeCollapsedSections(DEFAULT_COLLAPSED_SECTIONS, storage);
  return [...DEFAULT_COLLAPSED_SECTIONS];
};
