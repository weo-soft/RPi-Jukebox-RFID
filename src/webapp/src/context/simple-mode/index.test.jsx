import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';

import SimpleModeProvider, { useSimpleMode } from './index';
import { SIMPLE_MODE_KEY } from './simple-mode';

const Probe = () => {
  const { setSimpleMode, simpleMode } = useSimpleMode();

  return (
    <>
      <span data-testid="simple">{String(simpleMode)}</span>
      <button onClick={() => setSimpleMode(!simpleMode)} type="button">toggle</button>
    </>
  );
};

const renderMode = (kiosk) => render(
  <SimpleModeProvider kiosk={kiosk}>
    <Probe />
  </SimpleModeProvider>,
);

beforeEach(() => {
  window.localStorage.clear();
});

test('the kiosk seeds simple mode to on', () => {
  renderMode(true);

  expect(screen.getByTestId('simple')).toHaveTextContent('true');
  expect(window.localStorage.getItem(SIMPLE_MODE_KEY)).toBe('true');
});

test('a desktop seeds simple mode to off', () => {
  renderMode(false);

  expect(screen.getByTestId('simple')).toHaveTextContent('false');
  expect(window.localStorage.getItem(SIMPLE_MODE_KEY)).toBe('false');
});

test('an existing value is not overwritten by the seed', () => {
  window.localStorage.setItem(SIMPLE_MODE_KEY, 'false');

  renderMode(true);

  expect(screen.getByTestId('simple')).toHaveTextContent('false');
  expect(window.localStorage.getItem(SIMPLE_MODE_KEY)).toBe('false');
});

test('the switch stores the choice for this device', async () => {
  const user = userEvent.setup();
  renderMode(false);

  await user.click(screen.getByRole('button', { name: 'toggle' }));

  expect(screen.getByTestId('simple')).toHaveTextContent('true');
  expect(window.localStorage.getItem(SIMPLE_MODE_KEY)).toBe('true');
});
