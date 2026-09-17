/*
 * Shared layout of the library lists: the rows are tall enough for two title
 * lines and a large cover, and the list spreads over two columns as soon as
 * the landscape tier has room for it.
 */
export const LIBRARY_LIST_SX = {
  display: 'grid',
  gridTemplateColumns: { md: 'repeat(2, minmax(0, 1fr))', xs: 'minmax(0, 1fr)' },
  width: '100%',
};

export const LIBRARY_ROW_SX = {
  minHeight: 96,
};

export const LIBRARY_PRIMARY_SX = {
  display: '-webkit-box',
  fontSize: 'var(--font-body)',
  overflow: 'hidden',
  overflowWrap: 'anywhere',
  WebkitBoxOrient: 'vertical',
  WebkitLineClamp: 2,
};

export const LIBRARY_SECONDARY_SX = {
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
};

export const LIBRARY_AVATAR_SX = {
  height: 88,
  width: 88,
};

// MUI reserves a fixed 48 px for a secondary action; the action itself needs
// its own width plus the distance from the edge.
export const LIBRARY_ACTION_SPACE_SX = {
  paddingRight: 'calc(var(--touch-min) + var(--space-6))',
};
