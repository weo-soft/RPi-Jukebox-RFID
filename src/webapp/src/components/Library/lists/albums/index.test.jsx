import {
  afterEach,
  beforeEach,
  describe,
  expect,
  test,
  vi,
} from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import AppSettingsContext from '../../../../context/appsettings/context';
import request from '../../../../utils/request';
import Albums from './index';

vi.mock('../../../../utils/request', () => ({
  default: vi.fn(),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options = {}) => options.defaultValue || key,
  }),
}));

const jellyfinAlbums = [
  {
    provider: 'jellyfin',
    content_type: 'album',
    content_uri: 'service:jellyfin:album:album-1',
    albumartist: 'Artist One',
    album: 'Album One',
    cover_url: null,
  },
  {
    provider: 'jellyfin',
    content_type: 'album',
    content_uri: 'service:jellyfin:album:album-2',
    albumartist: 'Artist Two',
    album: 'Album Two',
    cover_url: null,
  },
];

const renderAlbums = (props = {}) => render(
  <MemoryRouter>
    <AppSettingsContext.Provider value={{ settings: { show_covers: true } }}>
      <Albums
        contentTypes={['album']}
        isSelecting={false}
        musicFilter=""
        provider="jellyfin"
        view="albums"
        {...props}
      />
    </AppSettingsContext.Provider>
  </MemoryRouter>,
);

describe('Jellyfin album library view', () => {
  beforeEach(() => {
    request.mockReset();
    request.mockImplementation(async (command) => {
      if (command === 'libraryItems') {
        return { result: jellyfinAlbums, error: null };
      }
      return { result: null, error: null };
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  test('fetches the album catalog with the jellyfin provider and album content type', async () => {
    renderAlbums();

    expect(await screen.findByText('Album One')).toBeInTheDocument();
    expect(request).toHaveBeenCalledWith('libraryItems', {
      provider: 'jellyfin',
      content_types: ['album'],
    });
  });

  test('renders Jellyfin album titles and artists from the catalog', async () => {
    renderAlbums();

    expect(await screen.findByText('Album One')).toBeInTheDocument();
    expect(screen.getByText('Album Two')).toBeInTheDocument();
    expect(screen.getByText('Artist One')).toBeInTheDocument();
    expect(screen.getByText('Artist Two')).toBeInTheDocument();
  });

  test('requests cover art through the jellyfin provider', async () => {
    renderAlbums();

    await screen.findByText('Album One');
    expect(request).toHaveBeenCalledWith('getAlbumCoverArt', {
      albumartist: 'Artist One',
      album: 'Album One',
      content_uri: 'service:jellyfin:album:album-1',
      provider: 'jellyfin',
    });
  });

  test('shows the loading-error state when the catalog request fails', async () => {
    request.mockResolvedValue({ result: null, error: new Error('offline') });
    renderAlbums();

    expect(await screen.findByText('library.loading-error')).toBeInTheDocument();
    expect(screen.queryByText('Album One')).not.toBeInTheDocument();
  });
});

const makeAlbums = (count) => Array.from({ length: count }, (unused, index) => ({
  albumartist: `Artist ${index + 1}`,
  album: `Album ${index + 1}`,
  content_uri: null,
  provider: 'mpd',
}));

const renderPaginatedAlbums = ({
  albums = makeAlbums(30),
  configuredPageSize = 25,
} = {}) => {
  request.mockImplementation(async (command) => {
    if (command === 'libraryItems') return { result: albums };
    return { result: null };
  });

  return render(
    <AppSettingsContext.Provider
      value={{ settings: { library_page_size: configuredPageSize, show_covers: false } }}
    >
      <MemoryRouter>
        <Albums
          contentTypes={['album']}
          musicFilter=""
          provider="mpd"
          view="albums"
        />
      </MemoryRouter>
    </AppSettingsContext.Provider>,
  );
};

const albumItems = () => (
  within(screen.getByTestId('library-album-list')).getAllByRole('listitem')
);

describe('library pagination', () => {
  beforeEach(() => {
    window.localStorage.clear();
    request.mockReset();
  });

  test('the album list renders only the first page', async () => {
    renderPaginatedAlbums();

    expect(await screen.findByText('Album 1')).toBeInTheDocument();
    expect(albumItems()).toHaveLength(25);
    expect(screen.queryByText('Album 26')).not.toBeInTheDocument();
  });

  test('the pager moves to the remaining entries', async () => {
    const user = userEvent.setup();
    renderPaginatedAlbums();

    await screen.findByText('Album 1');
    await user.click(screen.getByRole('button', { name: 'Go to page 2' }));

    expect(await screen.findByText('Album 26')).toBeInTheDocument();
    expect(albumItems()).toHaveLength(5);
    expect(screen.queryByText('Album 1')).not.toBeInTheDocument();
  });

  test('the page size changes the number of rendered entries', async () => {
    const user = userEvent.setup();
    renderPaginatedAlbums();

    await screen.findByText('Album 1');
    await user.selectOptions(
      screen.getByLabelText('library.pagination.page-size'),
      '50',
    );

    await waitFor(() => {
      expect(albumItems()).toHaveLength(30);
    });
  });
});
