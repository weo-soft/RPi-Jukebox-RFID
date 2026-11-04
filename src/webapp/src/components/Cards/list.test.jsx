import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import CardsList from './list';


const translations = {
  'cards.controls.command-selector.commands.shutdown': 'Shut down',
  'cards.list.group-by-source': 'Group by source',
  'cards.list.no-cards-registered': 'No cards registered!',
  'cards.list.no-match': 'No card matches the search.',
  'cards.list.search': 'Search content or card ID',
  'cards.list.unassignable': 'Not assignable',
  'library.sources.jellyfin': 'Jellyfin',
  'library.sources.mpd': 'Local',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => translations[key] ?? options?.defaultValue ?? key,
  }),
}));

const cards = {
  '0001': {
    from_alias: 'play_album',
    action: { args: ['Benjamin Blümchen', 'Folge 37', null, 'mpd'] },
  },
  '0002': {
    from_alias: 'play_album',
    action: { args: ['Family', 'Bedtime Stories', 'service:album:1', 'jellyfin'] },
  },
  '0003': {
    from_alias: 'play_folder',
    action: { args: ['Music/Rock', true] },
  },
  '0004': {
    from_alias: 'shutdown',
    action: { args: null },
  },
};

const renderList = (props = {}) => render(
  <MemoryRouter>
    <CardsList cardsList={cards} {...props} />
  </MemoryRouter>,
);

test('an entry leads with its content and carries the card id below', () => {
  renderList();

  expect(screen.getByText('Folge 37')).toBeInTheDocument();
  expect(screen.getByText('0001')).toBeInTheDocument();
});

test('the entries are grouped by their source', () => {
  renderList();

  expect(screen.getByText('Local')).toBeInTheDocument();
  expect(screen.getByText('Jellyfin')).toBeInTheDocument();
  expect(screen.getByText('Not assignable')).toBeInTheDocument();
});

test('the grouping can be switched off', () => {
  renderList({ isGrouped: false });

  expect(screen.queryByText('Local')).not.toBeInTheDocument();
  expect(screen.getByText('Folge 37')).toBeInTheDocument();
});

test('the search finds a card by its content', () => {
  renderList({ search: 'bedtime' });

  expect(screen.queryByText('Folge 37')).not.toBeInTheDocument();
  expect(screen.getByText('Bedtime Stories')).toBeInTheDocument();
});

test('the search finds a card by its id', () => {
  renderList({ search: '0003' });

  expect(screen.getByText('Music/Rock')).toBeInTheDocument();
  expect(screen.getByText('0003')).toBeInTheDocument();
  expect(screen.queryByText('Folge 37')).not.toBeInTheDocument();
});

test('a card without content is named by its command', () => {
  renderList({ search: 'shut' });

  expect(screen.getByText('Shut down')).toBeInTheDocument();
  expect(screen.getByText('0004')).toBeInTheDocument();
});

test('a search without a match says so', () => {
  renderList({ search: 'nichts' });

  expect(screen.getByText('No card matches the search.')).toBeInTheDocument();
});

test('an empty card list says so', () => {
  render(
    <MemoryRouter>
      <CardsList cardsList={{}} />
    </MemoryRouter>,
  );

  expect(screen.getByText('No cards registered!')).toBeInTheDocument();
});
