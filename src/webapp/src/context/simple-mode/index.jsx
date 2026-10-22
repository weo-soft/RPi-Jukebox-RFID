import { useContext, useState } from 'react';

import SimpleModeContext from './context';
import {
  defaultSimpleMode,
  readSimpleMode,
  writeSimpleMode,
} from './simple-mode';

const SimpleModeProvider = ({
  children,
  kiosk = defaultSimpleMode(),
}) => {
  const [simpleMode, setSimpleModeState] = useState(() => {
    const stored = readSimpleMode();
    if (stored !== null) return stored;

    const initial = kiosk;
    writeSimpleMode(initial);
    return initial;
  });

  const setSimpleMode = (value) => {
    writeSimpleMode(value);
    setSimpleModeState(value);
  };

  const context = {
    setSimpleMode,
    simpleMode,
  };

  return (
    <SimpleModeContext.Provider value={context}>
      {children}
    </SimpleModeContext.Provider>
  );
};

const useSimpleMode = () => useContext(SimpleModeContext);

export { SimpleModeProvider, useSimpleMode };
export default SimpleModeProvider;
