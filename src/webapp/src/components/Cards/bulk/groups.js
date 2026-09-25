import { collator } from './orders';

/*
 * The groupings the albums of a source are listed in while the albums of a bulk
 * registration are chosen. Their groups are an axis a physical stack is sorted
 * by:
 * the album artist carries a mixed stock, the initials carry a large one.
 */

// The bucket of an initial grouping: the first letter of a name and '#' for a
// name that starts with anything else.
const initialOf = (value) => {
  const first = (value || '').trim().charAt(0);

  return /\p{L}/u.test(first) ? first.toUpperCase() : '#';
};

const byAlbumArtist = ({ albumartist }) => albumartist || '';
const byAlbumArtistInitial = ({ albumartist }) => initialOf(albumartist);
const byAlbumInitial = ({ album }) => initialOf(album);

const GROUPINGS = [
  {
    id: 'albumartist',
    labelKey: 'cards.bulk.choice.groupings.albumartist',
    groupOf: byAlbumArtist,
  },
  {
    id: 'albumartist-initial',
    labelKey: 'cards.bulk.choice.groupings.albumartist-initial',
    groupOf: byAlbumArtistInitial,
  },
  {
    id: 'album-initial',
    labelKey: 'cards.bulk.choice.groupings.album-initial',
    groupOf: byAlbumInitial,
  },
];

const DEFAULT_GROUPING_ID = 'albumartist';

const groupingById = (id) => (
  GROUPINGS.find(({ id: groupingId }) => groupingId === id) || GROUPINGS[0]
);

// The albums the library cannot attribute and the ones outside the alphabet end
// the list: they are the exception, not the start of a stack.
const LAST_GROUP_IDS = ['', '#'];

const isLastGroup = id => LAST_GROUP_IDS.includes(id);

const byGroupId = (left, right) => {
  if (isLastGroup(left.id) || isLastGroup(right.id)) {
    if (isLastGroup(left.id) && isLastGroup(right.id)) {
      return collator.compare(left.id, right.id);
    }

    return isLastGroup(left.id) ? 1 : -1;
  }

  return collator.compare(left.id, right.id);
};

/*
 * The groups of an album list in the order of the grouping. 'isChosen' counts
 * the albums that take part in the registration and 'open' the ones without a card,
 * so a group states both the selection and the work left in it.
 */
const groupAlbums = (albums = [], groupingId, isChosen = () => false) => {
  const { groupOf } = groupingById(groupingId);
  const groups = new Map();

  albums.forEach((album) => {
    const id = groupOf(album);
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(album);
  });

  return [...groups.entries()]
    .map(([id, entries]) => ({
      id,
      albums: entries,
      chosen: entries.filter(album => isChosen(album)).length,
      open: entries.filter(({ bound }) => !bound).length,
      total: entries.length,
    }))
    .sort(byGroupId);
};

export {
  DEFAULT_GROUPING_ID,
  GROUPINGS,
  groupAlbums,
  groupingById,
  initialOf,
};
