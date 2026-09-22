import { ALBUM_ALIAS, albumFromArgs, albumKey } from './series/keys';

const FOLDER_ALIAS = 'play_folder';
const SONG_ALIAS = 'play_single';

/*
 * One card, described by what it holds: an album, a folder, a single song or
 * nothing a series can work with - system, timer, volume and hand-written
 * entries.
 */
const describeCard = (card = {}) => {
  const { action = {}, from_alias: alias } = card;
  // list_cards returns args as null for an entry without an args key.
  const args = action.args ?? [];

  if (alias === ALBUM_ALIAS && args.length) {
    const album = albumFromArgs(args);
    return { type: 'album', ...album, key: albumKey(album) };
  }

  if (alias === FOLDER_ALIAS && args.length) {
    return { type: 'folder', folder: args[0] };
  }

  if (alias === SONG_ALIAS && args.length) {
    return { type: 'song', songUrl: args[0] };
  }

  return { type: 'other', command: alias || null };
};

// The content a card holds, as leading text of a card list entry. Cards without
// content answer null; their list entry is named by their command.
const describeText = (card) => {
  const description = describeCard(card);

  if (description.type === 'album') return description.album || null;
  if (description.type === 'folder') return description.folder || null;
  if (description.type === 'song') return description.songUrl || null;

  return null;
};

// Cards that hold no album of the library: folders, songs, system, timer and
// volume cards as well as hand-written entries.
const unassignableCards = (cardsList = {}) => (
  Object.entries(cardsList)
    .filter(([, card]) => describeCard(card).type !== 'album')
    .map(([cardId]) => cardId)
);

export {
  describeCard,
  describeText,
  unassignableCards,
};
