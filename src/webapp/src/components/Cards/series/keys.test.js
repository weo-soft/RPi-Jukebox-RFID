import { expect, test } from 'vitest';

import commands from '../../../commands';
import {
  ALBUM_ARGS,
  albumFromArgs,
  albumKey,
  boundKeys,
  isAlbumCard,
} from './keys';


const localAlbum = {
  albumartist: 'Benjamin Blümchen',
  album: 'Folge 37',
  content_uri: null,
  provider: 'mpd',
};

test('the album arguments are declared by the command itself', () => {
  expect(ALBUM_ARGS).toBe(commands.play_album.argKeys);
});

test('the same album from two sources is two albums', () => {
  const streaming = { ...localAlbum, provider: 'jellyfin', content_uri: 'service:album:37' };

  expect(albumKey(localAlbum)).not.toEqual(albumKey(streaming));
  expect(albumKey(localAlbum)).toEqual(albumKey({ ...localAlbum }));
});

test('cards written before the provider became an argument still match the local source', () => {
  const legacy = albumFromArgs(['Benjamin Blümchen', 'Folge 37']);

  expect(legacy.provider).toBeUndefined();
  expect(albumKey(legacy)).toEqual(albumKey(localAlbum));
});

test('the arguments are read in the order the command declares', () => {
  expect(albumFromArgs(['Artist', 'Album', 'service:album:1', 'streaming'])).toEqual({
    albumartist: 'Artist',
    album: 'Album',
    content_uri: 'service:album:1',
    provider: 'streaming',
  });
});

test('an album card holds its album', () => {
  const cards = {
    '0001': {
      from_alias: 'play_album',
      action: { args: ['Benjamin Blümchen', 'Folge 37', null, 'mpd'] },
    },
  };

  expect(boundKeys(cards).has(albumKey(localAlbum))).toBe(true);
});

test('a card without arguments holds nothing', () => {
  const cards = {
    '0001': { from_alias: 'play_album', action: { args: null } },
    '0002': { from_alias: 'play_album', action: { args: [] } },
    '0003': { action: { args: ['Benjamin Blümchen', 'Folge 37', null, 'mpd'] } },
  };

  expect(boundKeys(cards).size).toBe(0);
});

test('a folder card holds no album', () => {
  const cards = {
    '0001': { from_alias: 'play_folder', action: { args: ['Music/Rock', true] } },
  };

  expect(boundKeys(cards).size).toBe(0);
  expect(isAlbumCard(cards['0001'])).toBe(false);
  expect(isAlbumCard({ from_alias: 'play_album' })).toBe(true);
});
