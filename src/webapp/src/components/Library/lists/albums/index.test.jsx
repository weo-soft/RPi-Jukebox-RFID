import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

import AppSettingsContext from '../../../../context/appsettings/context';
import request from '../../../../utils/request';
import Albums from './index';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

vi.mock('../../../../utils/request', () => ({
  default: vi.fn(),
}));

const makeAlbums = (count) => Array.from({ length: count }, (unused, index) => ({
  albumartist: `Artist ${index + 1}`,
  album: `Album ${index + 1}`,
  content_uri: null,
  provider: 'mpd',
}));

const renderAlbums = ({
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

beforeEach(() => {
  window.localStorage.clear();
  request.mockClear();
});

const albumItems = () => (
  within(screen.getByTestId('library-album-list')).getAllByRole('listitem')
);

test('the album list renders only the first page', async () => {
  renderAlbums();

  expect(await screen.findByText('Album 1')).toBeInTheDocument();
  expect(albumItems()).toHaveLength(25);
  expect(screen.queryByText('Album 26')).not.toBeInTheDocument();
});

test('the pager moves to the remaining entries', async () => {
  const user = userEvent.setup();
  renderAlbums();

  await screen.findByText('Album 1');
  await user.click(screen.getByRole('button', { name: 'Go to page 2' }));

  expect(await screen.findByText('Album 26')).toBeInTheDocument();
  expect(albumItems()).toHaveLength(5);
  expect(screen.queryByText('Album 1')).not.toBeInTheDocument();
});

test('the page size is stored for this device', async () => {
  const user = userEvent.setup();
  renderAlbums();

  await screen.findByText('Album 1');
  await user.selectOptions(
    screen.getByLabelText('library.pagination.page-size'),
    '50',
  );

  await waitFor(() => {
    expect(albumItems()).toHaveLength(30);
  });
});
