import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { expect, test, vi } from 'vitest';

import CardsForm from './form';


const translations = {
  'cards.card-id.label': 'Card ID',
  'cards.controls.actions.host.description': 'Host action',
  'cards.controls.command-selector.label': 'Command',
  'cards.controls.command-selector.placeholder': 'Select a command',
  'cards.controls.command-selector.title': 'Command',
  'cards.controls.controls-selector.label': 'Action',
  'cards.controls.select-command-aliases.actions.host': 'System',
  'cards.controls.select-command-aliases.label': 'Action',
  'cards.controls.select-command-aliases.placeholder': 'Select an action',
  'cards.form.card-id-hint': 'Swiping a card fills in the ID.',
  'cards.form.no-card-swiped': 'Please swipe a card',
};

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key, options) => translations[key] ?? options?.defaultValue ?? key,
  }),
}));

const Form = ({ initial }) => {
  const [cardId, setCardId] = useState(initial);
  const [actionData, setActionData] = useState({});

  return (
    <CardsForm
      actionData={actionData}
      cardId={cardId}
      onCardIdChange={setCardId}
      setActionData={setActionData}
      title="Register a card"
    />
  );
};

const renderForm = (initial = '') => render(
  <MemoryRouter initialEntries={['/']}>
    <Routes>
      <Route element={<Form initial={initial} />} path="/" />
    </Routes>
  </MemoryRouter>,
);

test('the form asks for a card while no id is there', () => {
  renderForm();

  expect(screen.getByText('Please swipe a card')).toBeInTheDocument();
  expect(screen.queryByText('Action')).not.toBeInTheDocument();
});

test('a placed card fills the field and opens the action selection', () => {
  renderForm('0001234567');

  expect(screen.getByDisplayValue('0001234567')).toBeInTheDocument();
  expect(screen.getByText('Swiping a card fills in the ID.')).toBeInTheDocument();
  expect(screen.getByText('Action')).toBeInTheDocument();
});

test('a typed card id opens the action selection as well', async () => {
  const user = userEvent.setup();
  renderForm();

  await user.type(screen.getByLabelText('Card ID'), '0001234567');

  expect(await screen.findByText('Action')).toBeInTheDocument();
  expect(screen.getByDisplayValue('0001234567')).toBeInTheDocument();
});

test('the field can be emptied again', async () => {
  const user = userEvent.setup();
  renderForm('0001234567');

  await user.clear(screen.getByLabelText('Card ID'));

  expect(screen.getByText('Please swipe a card')).toBeInTheDocument();
});

test('each selection level carries one name in label and aria-label', async () => {
  const user = userEvent.setup();
  renderForm('0001234567');

  const category = screen.getByLabelText('Action');
  expect(screen.getByText('Action')).toBeInTheDocument();

  await user.selectOptions(category, 'host');

  expect(screen.getByText('Command')).toBeInTheDocument();
  expect(screen.getByLabelText('Command')).toBeInTheDocument();
});
