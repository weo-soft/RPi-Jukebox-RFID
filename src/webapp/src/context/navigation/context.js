import { createContext } from 'react';

const NavigationVisibilityContext = createContext({
  globalVisible: false,
  localVisible: true,
  revealNavigation: () => {},
  setLocalVisibility: () => {},
  showStartNavigation: true,
});

export default NavigationVisibilityContext;
