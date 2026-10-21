/*
 * The navigation visibility of the start view belongs to the browser: the
 * kiosk, every desktop and every browser profile keep their own value. The
 * kiosk is the only client that loads the Web App from the box itself, so its
 * loopback origin selects the kiosk seed; all other origins start visible.
 */
const NAVIGATION_VISIBLE_KEY = 'navigationVisible';
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]'];
const DEFAULT_PORTS = ['', '80', '443'];

const isKioskOrigin = ({
  hostname = '',
  port = '',
} = {}) => (
  LOOPBACK_HOSTS.includes(hostname) && DEFAULT_PORTS.includes(port)
);

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
