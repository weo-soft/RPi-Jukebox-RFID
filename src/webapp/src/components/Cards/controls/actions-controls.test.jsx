import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, expect, test, vi } from 'vitest';

import request from '../../../utils/request';
import ActionsControls from './actions-controls';


const translations = {
  'cards.form.save-failed': 'Saving failed: {{error}}',
  'cards.bulk.conflict': 'Card {{cardId}} is already registered with {{content}}',
  'cards.bulk.conflict-list': 'Check in the card list',
  'cards.bulk.dismiss': 'Close',
  'cards.bulk.rebind': 'Reassign',
  'general.buttons.delete': 'Delete',
  'general.buttons.save': 'Save',
};

vi.mock('../../../utils/request', () => ({
  default: vi.fn(),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => {
      const value = translations[key] ?? options?.defaultValue ?? key;
      return Object.entries(options || {}).reduce(
        (text, [name, replacement]) => text.replace(`{{${name}}}`, String(replacement)),
        value,
      );
    },
  }),
}));

beforeEach(() => {
  request.mockReset();
});

const timerActionData = {
  action: 'timers',
  command: {
    name: 'timer_shutdown',
    args: { wait_seconds: 300 },
  },
};

const albumActionData = {
  action: 'play_music',
  command: {
    name: 'play_album',
    args: {
      albumartist: 'Artist',
      album: 'Album',
      content_uri: null,
      provider: 'mpd',
    },
  },
};

const renderControls = (entry, actionData, cards = {}) => {
  request.mockImplementation(async (command) => (
    command === 'cardsList' ? { result: cards } : { result: null }
  ));

  return render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>
        <Route
          path="/cards/*"
          element={<ActionsControls actionData={actionData} cardId="123" />}
        />
        <Route path="/cards" element={<div>Cards</div>} />
      </Routes>
    </MemoryRouter>,
  );
};

test('saving a legacy timer card submits restart=true', async () => {
  const user = userEvent.setup();
  renderControls('/cards/123/edit', timerActionData);

  await user.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('registerCard', {
      card_id: '123',
      cmd_alias: 'timer_shutdown',
      overwrite: true,
      args: [300, true],
    });
  });
});

test('the register path writes a free card without overwrite', async () => {
  const user = userEvent.setup();
  renderControls('/cards/register', albumActionData);

  await user.click(screen.getByRole('button', { name: 'Save' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('registerCard', {
      card_id: '123',
      cmd_alias: 'play_album',
      overwrite: false,
      args: ['Artist', 'Album', null, 'mpd'],
    });
  });
});

test('the register path reports an occupied card and writes nothing', async () => {
  const user = userEvent.setup();
  renderControls('/cards/register', albumActionData, {
    '123': {
      from_alias: 'play_album',
      action: { args: ['Andere', 'Platte', null, 'mpd'] },
    },
  });

  await user.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('Card 123 is already registered with Platte'))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Reassign' })).toBeInTheDocument();
  expect(request).not.toHaveBeenCalledWith('registerCard', expect.anything());
});

test('re-hanging writes the new binding with overwrite', async () => {
  const user = userEvent.setup();
  renderControls('/cards/register', albumActionData, {
    '123': {
      from_alias: 'play_album',
      action: { args: ['Andere', 'Platte', null, 'mpd'] },
    },
  });

  await user.click(screen.getByRole('button', { name: 'Save' }));
  await user.click(await screen.findByRole('button', { name: 'Reassign' }));

  await waitFor(() => {
    expect(request).toHaveBeenCalledWith('registerCard', {
      card_id: '123',
      cmd_alias: 'play_album',
      overwrite: true,
      args: ['Artist', 'Album', null, 'mpd'],
    });
  });
});

test('a failing call is shown instead of only logged', async () => {
  const user = userEvent.setup();
  request.mockImplementation(async (command) => (
    command === 'cardsList' ? { result: {} } : { error: 'backend unavailable' }
  ));

  render(
    <MemoryRouter initialEntries={['/cards/register']}>
      <Routes>
        <Route
          path="/cards/*"
          element={<ActionsControls actionData={albumActionData} cardId="123" />}
        />
      </Routes>
    </MemoryRouter>,
  );

  await user.click(screen.getByRole('button', { name: 'Save' }));

  expect(await screen.findByText('Saving failed: backend unavailable')).toBeInTheDocument();
});
