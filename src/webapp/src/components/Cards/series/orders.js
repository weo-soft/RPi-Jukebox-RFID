// A fixed collation keeps the order identical on every device: the physical
// stack is sorted once and has to keep matching the numbering.
const collator = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

// 'numeric' is why this is an Intl.Collator: 'Folge 2' sorts before 'Folge 10'.
const naturalAlbums = (left, right) => (
  collator.compare(left.album || '', right.album || '')
  || collator.compare(left.albumartist || '', right.albumartist || '')
);

const artistThenAlbum = (left, right) => (
  collator.compare(left.albumartist || '', right.albumartist || '')
  || collator.compare(left.album || '', right.album || '')
);

// Array.prototype.sort is stable, so an order without comparison keeps the
// sequence in which the library delivers.
const sourceOrder = () => 0;

const ORDERS = [
  {
    id: 'album-natural',
    labelKey: 'cards.series.orders.album-natural',
    compare: naturalAlbums,
  },
  {
    id: 'artist-album',
    labelKey: 'cards.series.orders.artist-album',
    compare: artistThenAlbum,
  },
  {
    id: 'source',
    labelKey: 'cards.series.orders.source',
    compare: sourceOrder,
  },
];

const DEFAULT_ORDER_ID = 'album-natural';

const orderById = (id) => ORDERS.find(({ id: orderId }) => orderId === id) || ORDERS[0];

export {
  DEFAULT_ORDER_ID,
  ORDERS,
  orderById,
};
