import { fireEvent, render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import Cover from './cover';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

test('seven taps on the cover reveal the navigation', () => {
  const reveal = vi.fn();
  render(<Cover onRevealNavigation={reveal} />);

  const cover = screen.getByTestId('player-cover');
  for (let tap = 0; tap < 6; tap += 1) {
    fireEvent.click(cover);
  }

  expect(reveal).not.toHaveBeenCalled();

  fireEvent.click(cover);

  expect(reveal).toHaveBeenCalledTimes(1);
});

test('a cover without a reveal handler ignores taps', () => {
  render(<Cover />);

  const cover = screen.getByTestId('player-cover');
  for (let tap = 0; tap < 7; tap += 1) {
    fireEvent.click(cover);
  }

  expect(cover).toBeInTheDocument();
});
