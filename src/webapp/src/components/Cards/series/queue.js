import { albumKey, boundKeys } from './keys';

// The queue is the album list of the chosen source in the chosen order. Every
// entry knows whether a card already holds it; bound albums stay in the list,
// they are simply not offered any more.
const buildQueue = ({ albums = [], cards = {}, compare } = {}) => {
  const held = boundKeys(cards);
  const ordered = [...albums];
  if (compare) ordered.sort(compare);

  return ordered.map((album, index) => {
    const key = albumKey(album);

    return {
      ...album,
      key,
      position: index + 1,
      bound: held.has(key),
    };
  });
};

const openCount = (queue = []) => queue.filter(({ bound }) => !bound).length;

// First open entry from 'from' onwards, or -1 when the series is exhausted.
const nextOpenIndex = (queue = [], from = 0) => {
  const start = Math.max(0, from);

  for (let index = start; index < queue.length; index += 1) {
    if (!queue[index].bound) return index;
  }

  return -1;
};

const indexOfAlbum = (queue = [], key) => queue.findIndex(entry => entry.key === key);

export {
  buildQueue,
  indexOfAlbum,
  nextOpenIndex,
  openCount,
};
