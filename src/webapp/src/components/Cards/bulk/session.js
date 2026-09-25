/*
 * The bindings of the current session. The stack covers the last bindings, not
 * only the last one: a wrong card is often noticed two cards later. A new
 * binding remembers nothing, a re-hang remembers the entry the card carried
 * before, so that the undo brings exactly that entry back.
 */
const EMPTY_SESSION = { entries: [] };

const rememberBinding = (session, { albumKey, cardId, previous = null }) => ({
  entries: [...session.entries, { albumKey, cardId, previous }],
});

const lastBinding = (session) => session.entries[session.entries.length - 1] || null;

const forgetBinding = (session) => ({
  entries: session.entries.slice(0, -1),
});

const withCard = (cardsList = {}, cardId, entry) => ({
  ...cardsList,
  [cardId]: entry,
});

const withoutCard = (cardsList = {}, cardId) => {
  const next = { ...cardsList };
  delete next[cardId];
  return next;
};

export {
  EMPTY_SESSION,
  forgetBinding,
  lastBinding,
  rememberBinding,
  withCard,
  withoutCard,
};
