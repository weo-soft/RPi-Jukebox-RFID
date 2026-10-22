import { useContext, useEffect, useState } from 'react';

import AppSettingsContext from '../appsettings/context';
import NavigationVisibilityContext from './context';
import {
  isKioskOrigin,
  navigationSeed,
  navigationVisible,
  readNavigationVisible,
  writeNavigationVisible,
} from './visibility';

/*
 * The local navigation setting is seeded once per browser: the kiosk starts
 * hidden, every other origin starts visible. The global setting from the box
 * configuration overrides the local value on all devices.
 */
const NavigationVisibilityProvider = ({
  children,
  kiosk = isKioskOrigin(window.location),
}) => {
  const { isLoaded, settings } = useContext(AppSettingsContext);
  const [localVisible, setLocalVisible] = useState(() => readNavigationVisible());
  const [hasSeed, setHasSeed] = useState(localVisible !== null);

  useEffect(() => {
    if (!isLoaded || hasSeed) return;

    const seed = navigationSeed({
      isKiosk: kiosk,
      kioskSeed: settings?.navigation_visible_kiosk_seed,
    });
    writeNavigationVisible(seed);
    setLocalVisible(seed);
    setHasSeed(true);
  }, [hasSeed, isLoaded, kiosk, settings?.navigation_visible_kiosk_seed]);

  const setLocalVisibility = (visible) => {
    writeNavigationVisible(visible);
    setLocalVisible(visible);
    setHasSeed(true);
  };

  const revealNavigation = () => setLocalVisibility(true);

  const effectiveLocal = localVisible ?? !kiosk;
  const globalVisible = Boolean(settings?.navigation_visible_global);
  const showStartNavigation = navigationVisible({
    globalVisible,
    localVisible: effectiveLocal,
  });

  const context = {
    globalVisible,
    localVisible: effectiveLocal,
    revealNavigation,
    setLocalVisibility,
    showStartNavigation,
  };

  return (
    <NavigationVisibilityContext.Provider value={context}>
      {children}
    </NavigationVisibilityContext.Provider>
  );
};

const useNavigationVisibility = () => useContext(NavigationVisibilityContext);

export { NavigationVisibilityProvider, useNavigationVisibility };
export default NavigationVisibilityProvider;
