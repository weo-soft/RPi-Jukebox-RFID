import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test } from 'vitest';

import HistorySwipeProvider, { useHistorySwipe } from './index';
import { HISTORY_SWIPE_KEY } from './history-swipe';

const Probe = () => {
  const { preventHistorySwipe, setPreventHistorySwipe } = useHistorySwipe();

  return (
    <>
      <span data-testid="guard">{String(preventHistorySwipe)}</span>
      <button
        onClick={() => setPreventHistorySwipe(!preventHistorySwipe)}
        type="button"
      >
        toggle
      </button>
    </>
  );
};

const renderGuard = (kiosk) => render(
  <HistorySwipeProvider kiosk={kiosk}>
    <Probe />
  </HistorySwipeProvider>,
);

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.classList.remove('history-swipe-locked');
});

test('the kiosk seeds the guard to on', async () => {
  renderGuard(true);

  expect(screen.getByTestId('guard')).toHaveTextContent('true');
  expect(window.localStorage.getItem(HISTORY_SWIPE_KEY)).toBe('true');
  await waitFor(() => {
    expect(document.documentElement).toHaveClass('history-swipe-locked');
  });
});

test('a desktop seeds the guard to off', () => {
  renderGuard(false);

  expect(screen.getByTestId('guard')).toHaveTextContent('false');
  expect(window.localStorage.getItem(HISTORY_SWIPE_KEY)).toBe('false');
  expect(document.documentElement).not.toHaveClass('history-swipe-locked');
});

test('an existing value is not overwritten by the seed', () => {
  window.localStorage.setItem(HISTORY_SWIPE_KEY, 'false');

  renderGuard(true);

  expect(screen.getByTestId('guard')).toHaveTextContent('false');
  expect(window.localStorage.getItem(HISTORY_SWIPE_KEY)).toBe('false');
});

test('the switch stores the choice and updates the root class', async () => {
  const user = userEvent.setup();
  renderGuard(false);

  await waitFor(() => {
    expect(screen.getByTestId('guard')).toHaveTextContent('false');
  });

  await user.click(screen.getByRole('button', { name: 'toggle' }));

  await waitFor(() => {
    expect(document.documentElement).toHaveClass('history-swipe-locked');
  });
  expect(window.localStorage.getItem(HISTORY_SWIPE_KEY)).toBe('true');
});
