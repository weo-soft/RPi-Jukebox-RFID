import { indexOfAlbum } from './queue';

/*
 * The start point of a card series lives in the browser: the source, the order
 * and the album key of the last bound album. A stored position number would
 * point somewhere else after every added or removed album, so only the album
 * key is kept and the number is computed from the current order.
 */
const SERIES_MEMORY_KEY = 'cardsSeriesMemory';

const isMemory = value => (
  value !== null
  && typeof value === 'object'
  && ['source', 'order', 'albumKey'].every(key => typeof value[key] === 'string')
);

const writeSeriesMemory = (memory, storage = window.localStorage) => {
  try {
    storage.setItem(SERIES_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Storage can be unavailable; the series then starts at the first open
    // album without a remembered start point.
  }
};

const readSeriesMemory = (storage = window.localStorage) => {
  try {
    const stored = storage.getItem(SERIES_MEMORY_KEY);
    if (stored !== null) {
      const parsed = JSON.parse(stored);
      if (isMemory(parsed)) return parsed;
    }
  } catch {
    // An unreadable entry counts as no entry.
  }

  return null;
};

// An album the current order does not know is dropped: the returned position is
// -1 and the series starts at the first open album.
const memoryPosition = (queue, memory) => (
  memory ? indexOfAlbum(queue, memory.albumKey) : -1
);

export {
  SERIES_MEMORY_KEY,
  memoryPosition,
  readSeriesMemory,
  writeSeriesMemory,
};
