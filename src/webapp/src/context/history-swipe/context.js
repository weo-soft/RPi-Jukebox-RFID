import { createContext } from 'react';

const HistorySwipeContext = createContext({
  preventHistorySwipe: false,
  setPreventHistorySwipe: () => {},
});

export default HistorySwipeContext;
