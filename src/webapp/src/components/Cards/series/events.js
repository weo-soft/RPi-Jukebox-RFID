// A card that lies on a reader with a repeating action reports itself every
// 0.2 s; a placed and removed card reports itself once.
const CARD_REPEAT_WINDOW_MS = 500;

/*
 * Every id the reader publishes is one placement, unless the same id was seen
 * within the window before - then it is the repetition of the placement that is
 * still lying there. A different id in between has a window of its own.
 */
const createPlacementCounter = (window = CARD_REPEAT_WINDOW_MS) => {
  const lastSeen = new Map();

  return ({ cardId, at }) => {
    const previous = lastSeen.get(cardId);
    lastSeen.set(cardId, at);

    return previous === undefined || at - previous >= window;
  };
};

export {
  CARD_REPEAT_WINDOW_MS,
  createPlacementCounter,
};
