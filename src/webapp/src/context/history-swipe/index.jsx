import { useContext, useEffect, useState } from 'react';

import HistorySwipeContext from './context';
import {
  defaultPreventHistorySwipe,
  readPreventHistorySwipe,
  writePreventHistorySwipe,
} from './history-swipe';

const HistorySwipeProvider = ({
  children,
  kiosk = defaultPreventHistorySwipe(),
}) => {
  const [preventHistorySwipe, setPreventHistorySwipeState] = useState(() => {
    const stored = readPreventHistorySwipe();
    if (stored !== null) return stored;

    const initial = kiosk;
    writePreventHistorySwipe(initial);
    return initial;
  });

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('history-swipe-locked', preventHistorySwipe);
    return () => root.classList.remove('history-swipe-locked');
  }, [preventHistorySwipe]);

  const setPreventHistorySwipe = (value) => {
    writePreventHistorySwipe(value);
    setPreventHistorySwipeState(value);
  };

  const context = {
    preventHistorySwipe,
    setPreventHistorySwipe,
  };

  return (
    <HistorySwipeContext.Provider value={context}>
      {children}
    </HistorySwipeContext.Provider>
  );
};

const useHistorySwipe = () => useContext(HistorySwipeContext);

export { HistorySwipeProvider, useHistorySwipe };
export default HistorySwipeProvider;
