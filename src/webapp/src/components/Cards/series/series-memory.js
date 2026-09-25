import { indexOfAlbum } from './queue';

/*
 * The start point of a card series lives in the browser: the source, the order,
 * the album key of the last bound album and the albums the series runs over. A
 * stored position number would point somewhere else after every added or removed
 * album, so only the album key is kept and the number is computed from the
 * current order.
 */
const SERIES_MEMORY_KEY = 'cardsSeriesMemory';

const isMemory = value => (
  value !== null
  && typeof value === 'object'
  && typeof value.source === 'string'
  && typeof value.order === 'string'
);

// A key arrives with the first binding: a series whose albums were only chosen
// has a selection and still no last album.
const albumKeyOf = value => (typeof value.albumKey === 'string' ? value.albumKey : '');

// A selection the reader cannot use counts as no selection: the series then runs
// over the whole source.
const selectionOf = value => {
  const usable = value !== null
    && typeof value === 'object'
    && typeof value.groupingId === 'string'
    && Array.isArray(value.albumKeys)
    && value.albumKeys.every(key => typeof key === 'string');

  return usable ? value : null;
};

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
      if (isMemory(parsed)) {
        return {
          source: parsed.source,
          order: parsed.order,
          albumKey: albumKeyOf(parsed),
          selection: selectionOf(parsed.selection),
        };
      }
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
