/*
 * The simple start view belongs to the device. The kiosk starts with it
 * enabled; every other origin starts with the full player controls.
 */
import { isKioskOrigin } from '../../utils/kiosk';

const SIMPLE_MODE_KEY = 'simpleMode';

const readSimpleMode = (storage = window.localStorage) => {
  try {
    const stored = storage.getItem(SIMPLE_MODE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Storage can be unavailable; the origin default applies for this visit.
  }

  return null;
};

const writeSimpleMode = (simpleMode, storage = window.localStorage) => {
  try {
    storage.setItem(SIMPLE_MODE_KEY, simpleMode ? 'true' : 'false');
  } catch {
    // Storage can be unavailable; the value only lives for this visit.
  }
};

const defaultSimpleMode = (location = window.location) => isKioskOrigin(location);

export {
  SIMPLE_MODE_KEY,
  defaultSimpleMode,
  readSimpleMode,
  writeSimpleMode,
};
