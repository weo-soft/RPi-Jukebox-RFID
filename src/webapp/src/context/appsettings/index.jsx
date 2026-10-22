import { useEffect, useState } from 'react';

import AppSettingsContext from './context';
import request from '../../utils/request';

const AppSettingsProvider = ({ children }) => {
  const [isLoaded, setIsLoaded] = useState(false);
  const [settings, setSettings] = useState({});

  useEffect(() => {
    const loadAppSettings = async () => {
      const { result, error } = await request('getAppSettings');
      if(result) setSettings(result);
      if(error) {
        console.error('Error loading AppSettings');
      }
      setIsLoaded(true);
    }

    loadAppSettings();
  }, []);

  const context = {
    isLoaded,
    setSettings,
    settings,
  };

  return(
    <AppSettingsContext.Provider value={context}>
      { children }
    </AppSettingsContext.Provider>
  )
};

export default AppSettingsProvider;
