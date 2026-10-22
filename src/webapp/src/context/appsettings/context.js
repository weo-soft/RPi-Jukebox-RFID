import { createContext } from 'react';

const AppSettingsContext = createContext({
  isLoaded: false,
  setSettings: () => {},
  settings: {},
});

export default AppSettingsContext;
