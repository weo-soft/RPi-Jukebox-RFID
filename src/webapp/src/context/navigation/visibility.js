/*
 * The navigation visibility of the start view belongs to the browser: the
 * kiosk, every desktop and every browser profile keep their own value. The
 * kiosk is the only client that loads the Web App from the box itself, so its
 * loopback origin selects the kiosk seed; all other origins start visible.
 */
import { isKioskOrigin } from '../../utils/kiosk';

const NAVIGATION_VISIBLE_KEY = 'navigationVisible';

const navigationSeed = ({ isKiosk, kioskSeed }) => (
  isKiosk ? Boolean(kioskSeed) : true
);

const navigationVisible = ({ globalVisible, localVisible }) => (
  Boolean(globalVisible) || Boolean(localVisible)
);

const readNavigationVisible = (storage = window.localStorage) => {
  try {
    const stored = storage.getItem(NAVIGATION_VISIBLE_KEY);
    if (stored === 'true') return true;
    if (stored === 'false') return false;
  } catch {
    // Storage can be unavailable; the origin default applies for this visit.
  }

  return null;
};

const writeNavigationVisible = (visible, storage = window.localStorage) => {
  try {
    storage.setItem(NAVIGATION_VISIBLE_KEY, visible ? 'true' : 'false');
  } catch {
    // Storage can be unavailable; the value only lives for this visit.
  }
};

export {
  NAVIGATION_VISIBLE_KEY,
  isKioskOrigin,
  navigationSeed,
  navigationVisible,
  readNavigationVisible,
  writeNavigationVisible,
};
