import { createContext } from 'react';

const SimpleModeContext = createContext({
  setSimpleMode: () => {},
  simpleMode: false,
});

export default SimpleModeContext;
