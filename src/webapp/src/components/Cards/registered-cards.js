import request from '../../utils/request';

// The card list is the base of every conflict test: an album counts as bound
// when a card names it, and a card counts as occupied when it is in this list.
const loadRegisteredCards = async () => {
  const { result, error } = await request('cardsList');

  if (error) return { error };
  return { cards: result || {} };
};

const registeredEntry = (cardsList, cardId) => {
  if (cardId === undefined || cardId === null) return undefined;
  return cardsList?.[String(cardId)];
};

export {
  loadRegisteredCards,
  registeredEntry,
};
