import commands from '../../../commands';

// The argument order is declared where the command is declared. A second list
// here would drift away from the coordinator.
const ALBUM_ARGS = commands.play_album.argKeys;
const ALBUM_ALIAS = 'play_album';

// An album is the same album only if source, artist, album name and content URI
// match. Without the provider a streaming album of the same name would mark the
// local entry as bound and drop it from the queue.
const albumKey = ({ provider, albumartist, album, content_uri: contentUri } = {}) => (
  JSON.stringify([provider || 'mpd', albumartist || '', album || '', contentUri || null])
);

const albumFromArgs = (args = []) => Object.fromEntries(
  ALBUM_ARGS.map((name, index) => [name, args[index]]),
);

const isAlbumCard = ({ from_alias: alias } = {}) => alias === ALBUM_ALIAS;

// The keys of all albums the card database already holds.
const boundKeys = (cardsList = {}) => {
  const albums = new Set();

  Object.values(cardsList).forEach((card) => {
    if (!isAlbumCard(card)) return;
    // list_cards returns args as null for an entry without an args key.
    const args = card.action?.args ?? [];
    if (!args.length) return;
    albums.add(albumKey(albumFromArgs(args)));
  });

  return albums;
};

export {
  ALBUM_ALIAS,
  ALBUM_ARGS,
  albumFromArgs,
  albumKey,
  boundKeys,
  isAlbumCard,
};
