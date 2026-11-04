import { expect, test } from 'vitest';

import {
  CARD_REPEAT_WINDOW_MS,
  createPlacementCounter,
} from './events';


test('the same id inside the window is one placement', () => {
  const isNewPlacement = createPlacementCounter();

  expect(isNewPlacement({ cardId: '0001', at: 0 })).toBe(true);
  expect(isNewPlacement({ cardId: '0001', at: 200 })).toBe(false);
  expect(isNewPlacement({ cardId: '0001', at: CARD_REPEAT_WINDOW_MS - 1 })).toBe(false);
});

test('the same id after the window is a placement of its own', () => {
  const isNewPlacement = createPlacementCounter();

  isNewPlacement({ cardId: '0001', at: 0 });

  expect(isNewPlacement({ cardId: '0001', at: CARD_REPEAT_WINDOW_MS })).toBe(true);
});

test('a placement of another card leaves the window of the first one alone', () => {
  const isNewPlacement = createPlacementCounter();

  expect(isNewPlacement({ cardId: '0001', at: 0 })).toBe(true);
  expect(isNewPlacement({ cardId: '0002', at: 200 })).toBe(true);
  expect(isNewPlacement({ cardId: '0001', at: 300 })).toBe(false);
  expect(isNewPlacement({ cardId: '0002', at: 300 })).toBe(false);
});

test('the order of the placements is kept', () => {
  const isNewPlacement = createPlacementCounter();
  const events = [
    { cardId: '0001', at: 0 },
    { cardId: '0001', at: 200 },
    { cardId: '0002', at: 400 },
    { cardId: '0001', at: 900 },
    { cardId: '0002', at: 1000 },
  ];

  expect(events.filter(isNewPlacement).map(({ cardId }) => cardId))
    .toEqual(['0001', '0002', '0001', '0002']);
});
