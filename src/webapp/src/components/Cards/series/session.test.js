import { expect, test } from 'vitest';

import {
  EMPTY_SESSION,
  forgetBinding,
  lastBinding,
  rememberBinding,
  withCard,
  withoutCard,
} from './session';


test('a new binding is remembered without a predecessor', () => {
  const session = rememberBinding(EMPTY_SESSION, { albumKey: '["mpd","A","B",null]', cardId: '0001' });

  expect(session.entries).toEqual([
    { albumKey: '["mpd","A","B",null]', cardId: '0001', previous: null },
  ]);
});

test('a re-hang keeps the entry the card carried before', () => {
  const previous = { from_alias: 'change_volume', action: { args: [5] }, ignore_same_id_delay: true };
  const session = rememberBinding(EMPTY_SESSION, {
    albumKey: '["mpd","A","B",null]',
    cardId: '0001',
    previous,
  });

  expect(lastBinding(session).previous).toEqual(previous);
});

test('an empty stack has no last binding', () => {
  expect(lastBinding(EMPTY_SESSION)).toBeNull();
});

test('the stack covers the last bindings and loses one at a time', () => {
  const first = rememberBinding(EMPTY_SESSION, { albumKey: 'k1', cardId: '0001' });
  const second = rememberBinding(first, { albumKey: 'k2', cardId: '0002' });
  const third = rememberBinding(second, { albumKey: 'k3', cardId: '0003' });

  expect(third.entries.map(({ cardId }) => cardId)).toEqual(['0001', '0002', '0003']);

  const afterUndo = forgetBinding(third);
  expect(afterUndo.entries.map(({ cardId }) => cardId)).toEqual(['0001', '0002']);
  expect(lastBinding(forgetBinding(EMPTY_SESSION))).toBeNull();
});

test('the local card list follows the binding and the undo', () => {
  const entry = { from_alias: 'play_album', action: { args: ['A', 'B', null, 'mpd'] } };

  const bound = withCard({ '0002': {} }, '0001', entry);
  expect(Object.keys(bound)).toEqual(['0002', '0001']);
  expect(bound['0001']).toEqual(entry);

  const unbound = withoutCard(bound, '0001');
  expect(Object.keys(unbound)).toEqual(['0002']);
  expect(withoutCard(unbound, '0009')).toEqual({ '0002': {} });
});
