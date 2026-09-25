import { expect, test } from 'vitest';

import {
  DEFAULT_GROUPING_ID,
  GROUPINGS,
  groupAlbums,
  groupingById,
  initialOf,
} from './groups';


const album = (albumartist, name, bound = false) => ({
  album: name,
  albumartist,
  bound,
});

const albums = [
  album('Die Ärzte', 'Jazz ist anders'),
  album('Benjamin Blümchen', 'Folge 2', true),
  album('Benjamin Blümchen', 'Folge 10'),
  album('', 'Ohne Interpret'),
];

const namesOf = (groups) => groups.map(({ id }) => id);

test('the album artist is the default grouping, an unknown one falls back to it', () => {
  expect(groupingById(DEFAULT_GROUPING_ID).id).toBe('albumartist');
  expect(groupingById('nobody-knows').id).toBe('albumartist');
  expect(GROUPINGS.map(({ id }) => id)).toEqual([
    'albumartist',
    'albumartist-initial',
    'album-initial',
  ]);
});

test('the albums of one artist form a group with its selection and its work left', () => {
  const groups = groupAlbums(albums, 'albumartist', ({ album: name }) => name !== 'Folge 10');
  const benjamin = groups.find(({ id }) => id === 'Benjamin Blümchen');

  expect(benjamin.albums.map(({ album: name }) => name)).toEqual(['Folge 2', 'Folge 10']);
  expect(benjamin).toMatchObject({ chosen: 1, open: 1, total: 2 });
});

test('the groups are ordered by name, the unattributed ones last', () => {
  expect(namesOf(groupAlbums(albums, 'albumartist'))).toEqual([
    'Benjamin Blümchen',
    'Die Ärzte',
    '',
  ]);
});

test('an initial grouping buckets the letters and collects the rest under #', () => {
  expect(namesOf(groupAlbums(albums, 'albumartist-initial'))).toEqual(['B', 'D', '#']);
  expect(namesOf(groupAlbums(albums, 'album-initial'))).toEqual(['F', 'J', 'O']);

  expect(initialOf('Ärzte')).toBe('Ä');
  expect(initialOf('  3 Alben')).toBe('#');
  expect(initialOf('')).toBe('#');
  expect(initialOf(undefined)).toBe('#');
});

test('an empty album list has no group', () => {
  expect(groupAlbums([], 'albumartist')).toEqual([]);
  expect(groupAlbums()).toEqual([]);
  expect(groupAlbums(albums, 'albumartist')[0].chosen).toBe(0);
});
