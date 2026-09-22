import { expect, test } from 'vitest';

import {
  buildQueue,
  indexOfAlbum,
  nextOpenIndex,
  openCount,
} from './queue';
import { albumKey } from './keys';
import { orderById } from './orders';


const localAlbums = [
  { albumartist: 'Benjamin Blümchen', album: 'Folge 10', provider: 'mpd', content_uri: null },
  { albumartist: 'Benjamin Blümchen', album: 'Folge 2', provider: 'mpd', content_uri: null },
  { albumartist: 'Die Ärzte', album: 'Jazz ist anders', provider: 'mpd', content_uri: null },
];

const streamingAlbum = {
  albumartist: 'Family',
  album: 'Bedtime Stories',
  provider: 'jellyfin',
  content_uri: 'service:album:1',
};

const albumCard = (cardId, artist, album, provider = 'mpd', contentUri = null) => ([
  cardId,
  {
    from_alias: 'play_album',
    action: { args: [artist, album, contentUri, provider] },
  },
]);

const albumKeyOf = ({ albumartist, album, provider, content_uri: contentUri }) => albumKey({
  albumartist,
  album,
  provider,
  content_uri: contentUri,
});

test('an empty card list leaves the whole queue open', () => {
  const queue = buildQueue({ albums: localAlbums, compare: orderById('album-natural').compare });

  expect(openCount(queue)).toBe(3);
  expect(nextOpenIndex(queue, 0)).toBe(0);
});

test('a bound album stays in the list and is not offered', () => {
  const cards = Object.fromEntries([
    albumCard('0001', 'Benjamin Blümchen', 'Folge 2'),
  ]);
  const queue = buildQueue({ albums: localAlbums, cards, compare: orderById('album-natural').compare });

  expect(queue[0]).toMatchObject({ album: 'Folge 2', position: 1, bound: true });
  expect(openCount(queue)).toBe(2);
  expect(nextOpenIndex(queue, 0)).toBe(1);
});

test('the natural order puts Folge 2 before Folge 10', () => {
  const queue = buildQueue({ albums: localAlbums, compare: orderById('album-natural').compare });

  expect(queue.map(({ album }) => album)).toEqual([
    'Folge 2',
    'Folge 10',
    'Jazz ist anders',
  ]);
  expect(queue.map(({ position }) => position)).toEqual([1, 2, 3]);
});

test('the source order keeps the order the library delivers', () => {
  const queue = buildQueue({ albums: localAlbums, compare: orderById('source').compare });

  expect(queue.map(({ album }) => album)).toEqual(['Folge 10', 'Folge 2', 'Jazz ist anders']);
});

test('the queue starts at the first open album from a position onwards', () => {
  const cards = Object.fromEntries([
    albumCard('0001', 'Benjamin Blümchen', 'Folge 2'),
    albumCard('0002', 'Benjamin Blümchen', 'Folge 10'),
  ]);
  const queue = buildQueue({ albums: localAlbums, cards, compare: orderById('album-natural').compare });

  expect(openCount(queue)).toBe(1);
  expect(nextOpenIndex(queue, 0)).toBe(2);
  expect(nextOpenIndex(queue, 2)).toBe(2);
  expect(nextOpenIndex(queue, 3)).toBe(-1);
});

test('an album of another source stays open', () => {
  const albums = [...localAlbums, streamingAlbum];
  const localCard = Object.fromEntries([
    albumCard('0001', 'Benjamin Blümchen', 'Folge 2'),
  ]);
  const queue = buildQueue({ albums, cards: localCard, compare: orderById('album-natural').compare });

  expect(indexOfAlbum(queue, albumKeyOf(streamingAlbum))).toBeGreaterThan(-1);
  expect(openCount(queue)).toBe(3);
});

test('a card of another source does not close the local album of the same name', () => {
  const cards = Object.fromEntries([
    albumCard('0001', 'Benjamin Blümchen', 'Folge 2', 'jellyfin', 'service:album:2'),
  ]);
  const queue = buildQueue({ albums: localAlbums, cards, compare: orderById('album-natural').compare });

  expect(openCount(queue)).toBe(3);
  expect(indexOfAlbum(queue, albumKeyOf({
    albumartist: 'Benjamin Blümchen',
    album: 'Folge 2',
    provider: 'jellyfin',
    content_uri: 'service:album:2',
  }))).toBe(-1);
});

test('an unknown album key has no position', () => {
  const queue = buildQueue({ albums: localAlbums, compare: orderById('album-natural').compare });

  expect(indexOfAlbum(queue, '["mpd","Nobody","Nothing",null]')).toBe(-1);
});
