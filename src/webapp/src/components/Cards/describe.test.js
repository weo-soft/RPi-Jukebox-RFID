import { expect, test } from 'vitest';

import {
  describeCard,
  describeText,
  unassignableCards,
} from './describe';
import { albumKey } from './bulk/keys';


test('an album card is described by its album', () => {
  const card = {
    from_alias: 'play_album',
    action: { args: ['Benjamin Blümchen', 'Folge 37', null, 'mpd'] },
  };

  expect(describeCard(card)).toEqual({
    type: 'album',
    albumartist: 'Benjamin Blümchen',
    album: 'Folge 37',
    content_uri: null,
    provider: 'mpd',
    key: albumKey({
      albumartist: 'Benjamin Blümchen',
      album: 'Folge 37',
      content_uri: null,
      provider: 'mpd',
    }),
  });
  expect(describeText(card)).toBe('Folge 37');
});

test('a folder card and a song card are described by their target', () => {
  expect(describeCard({
    from_alias: 'play_folder',
    action: { args: ['Music/Rock', true] },
  })).toEqual({ type: 'folder', folder: 'Music/Rock' });
  expect(describeText({
    from_alias: 'play_folder',
    action: { args: ['Music/Rock', true] },
  })).toBe('Music/Rock');

  expect(describeCard({
    from_alias: 'play_single',
    action: { args: ['Music/Rock/sample.mp3', 'mpd'] },
  })).toEqual({ type: 'song', songUrl: 'Music/Rock/sample.mp3' });
});

test('a card without content is described by its command', () => {
  expect(describeCard({ from_alias: 'shutdown', action: { args: null } }))
    .toEqual({ type: 'other', command: 'shutdown' });
  expect(describeText({ from_alias: 'shutdown', action: { args: null } })).toBeNull();
  expect(describeCard({ action: { args: null } })).toEqual({ type: 'other', command: null });
});

test('cards without an album are not assignable', () => {
  const cards = {
    '0001': { from_alias: 'play_album', action: { args: ['Artist', 'Album', null, 'mpd'] } },
    '0002': { from_alias: 'play_folder', action: { args: ['Music/Rock', true] } },
    '0003': { from_alias: 'shutdown', action: { args: null } },
    '0004': { from_alias: 'play_album', action: { args: null } },
  };

  expect(unassignableCards(cards)).toEqual(['0002', '0003', '0004']);
});
