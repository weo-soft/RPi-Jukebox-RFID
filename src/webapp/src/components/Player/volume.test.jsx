import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, test, vi } from 'vitest';

import PubSubContext from '../../context/pubsub/context';
import request from '../../utils/request';
import Volume from './volume';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

vi.mock('../../utils/request', () => ({
  default: vi.fn(),
}));

const renderVolume = ({ max = 80, mute = false, volume = 40 } = {}) => {
  request.mockImplementation(async (command) => {
    if (command === 'getVolume') return { result: volume };
    if (command === 'getMaxVolume') return { result: max };
    return { result: null };
  });

  return render(
    <PubSubContext.Provider
      value={{ state: { 'volume.level': { mute, volume } } }}
    >
      <Volume />
    </PubSubContext.Provider>,
  );
};

beforeEach(() => {
  request.mockClear();
});

test('the plus button raises the volume by one step and reports it', async () => {
  const user = userEvent.setup();
  renderVolume();

  await waitFor(() => {
    expect(screen.getByTestId('volume-value')).toHaveTextContent('40');
  });

  await user.click(screen.getByTestId('volume-increase'));

  expect(request).toHaveBeenCalledWith('setVolume', { volume: 45 });
  expect(screen.getByTestId('volume-feedback')).toHaveTextContent('45 %');
});

test('the minus button lowers the volume by one step', async () => {
  const user = userEvent.setup();
  renderVolume();

  await waitFor(() => {
    expect(screen.getByTestId('volume-value')).toHaveTextContent('40');
  });

  await user.click(screen.getByTestId('volume-decrease'));

  expect(request).toHaveBeenCalledWith('setVolume', { volume: 35 });
});

test('the plus button stops at the configured maximum', async () => {
  renderVolume({ volume: 80 });

  await waitFor(() => {
    expect(screen.getByTestId('volume-value')).toHaveTextContent('80');
  });

  expect(screen.getByTestId('volume-increase')).toBeDisabled();
});

test('the minus button is disabled at zero', async () => {
  renderVolume({ volume: 0 });

  await waitFor(() => {
    expect(screen.getByTestId('volume-decrease')).toBeDisabled();
  });
  expect(screen.getByTestId('volume-increase')).toBeEnabled();
});

test('muting reports the state visually', async () => {
  const user = userEvent.setup();
  renderVolume();

  await waitFor(() => {
    expect(screen.getByTestId('volume-value')).toHaveTextContent('40');
  });

  await user.click(screen.getByRole('button', { name: 'player.volume.mute' }));

  expect(request).toHaveBeenCalledWith('toggleMuteVolume', { mute: true });
  expect(screen.getByTestId('volume-feedback')).toHaveTextContent('player.volume.muted');
});
