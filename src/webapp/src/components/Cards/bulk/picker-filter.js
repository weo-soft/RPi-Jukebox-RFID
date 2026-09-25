// The picker lists the albums of the source. 'Only open' hides the albums a
// card already holds, and the search narrows the list by album and artist.
const filterAlbums = (albums = [], { onlyOpen = true, search = '' } = {}) => {
  const needle = search.trim().toLowerCase();

  return albums.filter(({ album = '', albumartist = '', bound }) => {
    if (onlyOpen && bound) return false;
    if (!needle) return true;
    return `${albumartist} ${album}`.toLowerCase().includes(needle);
  });
};

export {
  filterAlbums,
};
