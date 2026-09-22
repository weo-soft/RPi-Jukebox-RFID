import { expect, test, vi } from 'vitest';

import request from '../../utils/request';
import {
  loadRegisteredCards,
  registeredEntry,
} from './registered-cards';


vi.mock('../../utils/request', () => ({
  default: vi.fn(),
}));

test('the card list is loaded as an object keyed by card id', async () => {
  request.mockResolvedValueOnce({ result: { '0001': { from_alias: 'play_album' } } });

  await expect(loadRegisteredCards()).resolves.toEqual({
    cards: { '0001': { from_alias: 'play_album' } },
  });
});

test('an empty result counts as an empty card list', async () => {
  request.mockResolvedValueOnce({ result: null });

  await expect(loadRegisteredCards()).resolves.toEqual({ cards: {} });
});

test('a failing card list is reported instead of counting as empty', async () => {
  request.mockResolvedValueOnce({ error: 'backend unavailable' });

  await expect(loadRegisteredCards()).resolves.toEqual({ error: 'backend unavailable' });
});

test('an entry is looked up by card id', () => {
  const cards = { '0001': { from_alias: 'play_album' } };

  expect(registeredEntry(cards, '0001')).toEqual({ from_alias: 'play_album' });
  expect(registeredEntry(cards, '0002')).toBeUndefined();
  expect(registeredEntry(cards, undefined)).toBeUndefined();
  expect(registeredEntry(cards, null)).toBeUndefined();
});
