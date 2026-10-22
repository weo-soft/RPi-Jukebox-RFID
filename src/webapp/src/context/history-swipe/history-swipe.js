/*
 * The history-swipe guard belongs to the device. The kiosk starts with it
 * enabled; every other origin starts without it.
 */
import { isKioskOrigin } from '../../utils/kiosk';

const HISTORY_SWIPE_KEY = 'preventHistorySwipe';

const readPreventHistorySwipe = (storage = window.localStorage) => {
  try {
    const stored = storage.getItem(HISTORY_SWIPE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Storage can be unavailable; the origin default applies for this visit.
  }

  return null;
};

const writePreventHistorySwipe = (prevent, storage = window.localStorage) => {
  try {
    storage.setItem(HISTORY_SWIPE_KEY, prevent ? 'true' : 'false');
  } catch {
    // Storage can be unavailable; the value only lives for this visit.
  }
};

const defaultPreventHistorySwipe = (location = window.location) => (
  isKioskOrigin(location)
);

export {
  HISTORY_SWIPE_KEY,
  defaultPreventHistorySwipe,
  readPreventHistorySwipe,
  writePreventHistorySwipe,
};
