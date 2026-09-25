import { indexOfAlbum } from './queue';

/*
 * The start point of a bulk registration lives in the browser: the source, the order,
 * the album key of the last bound album and the albums the registration runs over. A
 * stored position number would point somewhere else after every added or removed
 * album, so only the album key is kept and the number is computed from the
 * current order.
 */
const BULK_MEMORY_KEY = 'cardsBulkMemory';

const isMemory = value => (
  value !== null
  && typeof value === 'object'
  && typeof value.source === 'string'
  && typeof value.order === 'string'
);

// A key arrives with the first binding: a bulk registration whose albums were only chosen
// has a selection and still no last album.
const albumKeyOf = value => (typeof value.albumKey === 'string' ? value.albumKey : '');

// A selection the reader cannot use counts as no selection: the registration then runs
// over the whole source.
const selectionOf = value => {
  const usable = value !== null
    && typeof value === 'object'
    && typeof value.groupingId === 'string'
    && Array.isArray(value.albumKeys)
    && value.albumKeys.every(key => typeof key === 'string');

  return usable ? value : null;
};

const writeBulkMemory = (memory, storage = window.localStorage) => {
  try {
    storage.setItem(BULK_MEMORY_KEY, JSON.stringify(memory));
  } catch {
    // Storage can be unavailable; the registration then starts at the first open
    // album without a remembered start point.
  }
};

const readBulkMemory = (storage = window.localStorage) => {
  try {
    const stored = storage.getItem(BULK_MEMORY_KEY);
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
// -1 and the registration starts at the first open album.
const memoryPosition = (queue, memory) => (
  memory ? indexOfAlbum(queue, memory.albumKey) : -1
);

export {
  BULK_MEMORY_KEY,
  memoryPosition,
  readBulkMemory,
  writeBulkMemory,
};
