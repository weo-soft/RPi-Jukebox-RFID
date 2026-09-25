import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

import AppSettingsProvider from '../../../context/appsettings';
import PubSubContext from '../../../context/pubsub/context';
import request from '../../../utils/request';
import CardsBulk from './index';


const socket = vi.hoisted(() => ({ publish: null }));

vi.mock('../../../utils/request', () => ({
  default: vi.fn(),
}));

vi.mock('../../../sockets', () => ({
  initSockets: vi.fn(({ setState }) => {
    socket.publish = (cardId) => setState(
      state => ({ ...state, 'rfid.card_id': cardId }),
    );
    return () => {};
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

const albums = [
  { albumartist: 'Benjamin Blümchen', album: 'Folge 2', provider: 'mpd', content_uri: null },
  { albumartist: 'Benjamin Blümchen', album: 'Folge 10', provider: 'mpd', content_uri: null },
];

const albumCard = (cardId, alias, args) => ([
  cardId,
  { from_alias: alias, action: { args } },
]);

let cards = {};

beforeEach(() => {
  request.mockClear();
  cards = {};
  // The screen remembers source, order and the chosen albums: a leftover of an
  // earlier case would decide the start of the next one.
  window.localStorage.clear();
});

const answer = (command) => {
  switch (command) {
    case 'getAppSettings':
      return { result: { show_covers: false } };
    case 'librarySources':
      return { result: [{ id: 'mpd', label: 'Local', views: [] }] };
    case 'libraryItems':
      return { result: albums };
    case 'cardsList':
      return { result: cards };
    default:
      return { result: null };
  }
};

const openScreen = async ({ publishedCardId } = {}) => {
  request.mockImplementation(async (command) => answer(command));

  render(
    <AppSettingsProvider>
      <PubSubContext.Provider
        value={{
          setState: () => {},
          state: publishedCardId === undefined
            ? {}
            : { 'rfid.card_id': publishedCardId },
        }}
      >
        <MemoryRouter initialEntries={['/cards/bulk']}>
          <Routes>
            <Route element={<CardsBulk />} path="/cards/bulk" />
          </Routes>
        </MemoryRouter>
      </PubSubContext.Provider>
    </AppSettingsProvider>,
  );

  await screen.findByRole('button', { name: 'cards.bulk.start' });
};

const placeCard = async (cardId) => {
  await act(async () => { socket.publish(cardId); });
};

const startBulk = async (user) => {
  await user.click(screen.getByRole('button', { name: 'cards.bulk.start' }));
};

test('a placed card binds the album that is offered', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen();
  await startBulk(user);
  await placeCard('0001');

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('registerCard', {
      card_id: '0001',
      cmd_alias: 'play_album',
      args: ['Benjamin Blümchen', 'Folge 2', null, 'mpd'],
      overwrite: false,
    });
  });
  expect(await screen.findByText('cards.bulk.bound-at')).toBeInTheDocument();
});

test('the value of an earlier session binds nothing, the next placement does', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen({ publishedCardId: '0009' });
  await startBulk(user);
  await placeCard('0009');

  expect(request).not.toHaveBeenCalledWith('registerCard', expect.anything());

  await placeCard('0001');

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('registerCard', expect.objectContaining({
      card_id: '0001',
      overwrite: false,
    }));
  });
});

test('a repetition of the same card binds once', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen();
  await startBulk(user);
  await placeCard('0001');
  await placeCard('0001');

  await waitFor(() => {
    expect(request.mock.calls.filter(([command]) => command === 'registerCard')).toHaveLength(1);
  });
});

test('an occupied card opens the conflict and binds nothing', async () => {
  const user = userEvent.setup();
  cards = Object.fromEntries([
    albumCard('0001', 'play_album', ['Andere', 'Platte', null, 'mpd']),
  ]);

  await openScreen();
  await startBulk(user);
  await placeCard('0001');

  expect(await screen.findByText('cards.bulk.conflict')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'cards.bulk.rebind' })).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith('registerCard', expect.anything());
});

test('a card of another kind is not offered for re-hanging', async () => {
  const user = userEvent.setup();
  cards = Object.fromEntries([albumCard('0001', 'shutdown', null)]);

  await openScreen();
  await startBulk(user);
  await placeCard('0001');

  expect(await screen.findByText('cards.bulk.conflict')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'cards.bulk.rebind' })).not.toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'cards.bulk.conflict-list' }))
    .toHaveAttribute('href', '/cards?search=0001');
});

test('the undo removes the binding of the last card', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen();
  await startBulk(user);
  await placeCard('0001');
  await screen.findByText('cards.bulk.bound-at');

  await user.click(screen.getByRole('button', { name: 'cards.bulk.undo' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('deleteCard', { card_id: '0001' });
  });
});

test('the free mode binds the album that is chosen for the placed card', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen();
  await user.selectOptions(screen.getByLabelText('cards.bulk.mode'), 'free');
  await user.click(screen.getByRole('button', { name: 'cards.bulk.start-free' }));
  await placeCard('0001');

  expect(await screen.findByText('cards.bulk.picker-with-card')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: /Folge 10/ }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('registerCard', {
      card_id: '0001',
      cmd_alias: 'play_album',
      args: ['Benjamin Blümchen', 'Folge 10', null, 'mpd'],
      overwrite: false,
    });
  });
});

test('an album another card holds is not bound a second time', async () => {
  const user = userEvent.setup();
  cards = Object.fromEntries([
    albumCard('0002', 'play_album', ['Benjamin Blümchen', 'Folge 2', null, 'mpd']),
  ]);

  await openScreen();
  await user.selectOptions(screen.getByLabelText('cards.bulk.mode'), 'free');
  await user.click(screen.getByRole('button', { name: 'cards.bulk.start-free' }));
  await placeCard('0001');
  await screen.findByText('cards.bulk.picker-with-card');

  await user.click(screen.getByLabelText('cards.bulk.picker-only-open'));
  await user.click(screen.getByRole('button', { name: /Folge 2/ }));

  expect(await screen.findByText('cards.bulk.album-conflict')).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith('registerCard', expect.anything());
});

test('the header steps back into the start area before it leaves the screen', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen();

  // The start area itself leaves the screen for the card list.
  expect(screen.getByRole('link', { name: 'header.back' }))
    .toHaveAttribute('href', '/cards');

  await user.click(screen.getByRole('button', { name: 'cards.bulk.open-list' }));
  expect(await screen.findByLabelText('cards.bulk.list.search')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'header.back' }));

  expect(screen.getByLabelText('cards.bulk.source')).toBeInTheDocument();
});

test('the albums that were unticked stay out of the registration', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen();
  await user.click(screen.getByRole('button', { name: 'cards.bulk.choice.title' }));

  // The group is opened for its albums, and the first of them is taken out.
  await user.click(screen.getByRole('button', { name: /Benjamin/ }));
  await user.click(screen.getAllByRole('checkbox')[1]);
  await user.click(screen.getByRole('button', { name: 'cards.bulk.choice.confirm' }));

  await startBulk(user);
  await placeCard('0001');

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('registerCard', {
      card_id: '0001',
      cmd_alias: 'play_album',
      args: ['Benjamin Blümchen', 'Folge 10', null, 'mpd'],
      overwrite: false,
    });
  });
});

test('a bulk registration without a chosen album names the state and cannot start', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen();
  await user.click(screen.getByRole('button', { name: 'cards.bulk.choice.title' }));
  await user.click(screen.getByRole('button', { name: 'cards.bulk.choice.deselect-all' }));
  await user.click(screen.getByRole('button', { name: 'cards.bulk.choice.confirm' }));

  expect(await screen.findByText('cards.bulk.choice.empty')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'cards.bulk.start' })).toBeDisabled();
});

test('a cleared choice is built up again from a group', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen();
  await user.click(screen.getByRole('button', { name: 'cards.bulk.choice.title' }));
  await user.click(screen.getByRole('button', { name: 'cards.bulk.choice.deselect-all' }));
  await user.click(screen.getAllByRole('checkbox')[0]);
  await user.click(screen.getByRole('button', { name: 'cards.bulk.choice.confirm' }));

  await startBulk(user);
  await placeCard('0002');

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('registerCard', {
      card_id: '0002',
      cmd_alias: 'play_album',
      args: ['Benjamin Blümchen', 'Folge 2', null, 'mpd'],
      overwrite: false,
    });
  });
});

test('a typed card id binds without a reader', async () => {
  const user = userEvent.setup();
  cards = {};

  await openScreen();
  await startBulk(user);
  await user.type(screen.getByLabelText('cards.card-id.label'), '0002');
  await user.click(screen.getByRole('button', { name: 'cards.bulk.bind' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('registerCard', {
      card_id: '0002',
      cmd_alias: 'play_album',
      args: ['Benjamin Blümchen', 'Folge 2', null, 'mpd'],
      overwrite: false,
    });
  });
});
