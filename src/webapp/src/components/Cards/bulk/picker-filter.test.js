import { expect, test } from 'vitest';

import { filterAlbums } from './picker-filter';


const albums = [
  { album: 'Folge 2', albumartist: 'Benjamin Blümchen', bound: false },
  { album: 'Folge 10', albumartist: 'Benjamin Blümchen', bound: true },
  { album: 'Bedtime Stories', albumartist: 'Family', bound: false },
];

test('only open albums are offered by default', () => {
  expect(filterAlbums(albums).map(({ album }) => album)).toEqual([
    'Folge 2',
    'Bedtime Stories',
  ]);
});

test('all albums can be offered', () => {
  expect(filterAlbums(albums, { onlyOpen: false }).map(({ album }) => album))
    .toEqual(['Folge 2', 'Folge 10', 'Bedtime Stories']);
});

test('the search finds an album and an artist', () => {
  expect(filterAlbums(albums, { search: 'bedtime' }).map(({ album }) => album))
    .toEqual(['Bedtime Stories']);
  expect(filterAlbums(albums, { search: 'blümchen', onlyOpen: false }))
    .toHaveLength(2);
});

test('the search also finds a bound album while the filter hides it', () => {
  expect(filterAlbums(albums, { search: 'Folge 10' })).toEqual([]);
});
