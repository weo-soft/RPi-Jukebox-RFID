import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';

import HistorySwipeContext from '../../../context/history-swipe/context';
import HistorySwipe from './history-swipe';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

test('the switch changes the history guard of this device', async () => {
  const user = userEvent.setup();
  const setPreventHistorySwipe = vi.fn();

  render(
    <HistorySwipeContext.Provider
      value={{ preventHistorySwipe: false, setPreventHistorySwipe }}
    >
      <HistorySwipe />
    </HistorySwipeContext.Provider>,
  );

  await user.click(screen.getByRole('switch', {
    name: 'settings.general.history_swipe.title',
  }));

  expect(setPreventHistorySwipe).toHaveBeenCalledWith(true);
});
