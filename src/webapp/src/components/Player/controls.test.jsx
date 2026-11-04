import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import PlayerContext from '../../context/player/context';
import SimpleModeContext from '../../context/simple-mode/context';
import Controls from './controls';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

vi.mock('../../utils/request', () => ({
  default: vi.fn(),
}));

const playerState = {
  isPlaying: false,
  isRepeat: false,
  isShuffle: false,
  isSingle: false,
  playerstatus: { songid: '1', state: 'stop' },
  songIsScheduled: true,
};

const renderControls = (simpleMode) => render(
  <SimpleModeContext.Provider value={{ simpleMode }}>
    <PlayerContext.Provider value={{ setState: () => {}, state: playerState }}>
      <Controls />
    </PlayerContext.Provider>
  </SimpleModeContext.Provider>,
);

test('simple mode hides shuffle and repeat and shows no labels', () => {
  renderControls(true);

  expect(screen.queryByRole('button', {
    name: 'player.controls.shuffle.enable',
  })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', {
    name: 'player.controls.repeat.enable',
  })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'player.controls.prev_song' }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'player.controls.play' }))
    .toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'player.controls.next_song' }))
    .toBeInTheDocument();

  expect(screen.queryByText('player.controls.prev')).not.toBeInTheDocument();
  expect(screen.queryByText('player.controls.next')).not.toBeInTheDocument();
  expect(screen.queryByText('player.controls.play')).not.toBeInTheDocument();
});

test('regular mode shows shuffle, repeat and the labels', () => {
  renderControls(false);

  expect(screen.getByRole('button', {
    name: 'player.controls.shuffle.enable',
  })).toBeInTheDocument();
  expect(screen.getByRole('button', {
    name: 'player.controls.repeat.enable',
  })).toBeInTheDocument();

  expect(screen.getByText('player.controls.prev')).toBeInTheDocument();
  expect(screen.getByText('player.controls.next')).toBeInTheDocument();
  expect(screen.getByText('player.controls.shuffle.label')).toBeInTheDocument();
  expect(screen.getByText('player.controls.repeat.label')).toBeInTheDocument();
});

test('a tapped control keeps its press feedback briefly', async () => {
  renderControls(true);

  const previous = screen.getByRole('button', {
    name: 'player.controls.prev_song',
  });
  fireEvent.click(previous);

  expect(previous).toHaveAttribute('data-pressed', 'true');
  await waitFor(() => {
    expect(previous).toHaveAttribute('data-pressed', 'false');
  }, { timeout: 1200 });
});
