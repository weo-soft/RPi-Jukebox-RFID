import { render, screen } from '@testing-library/react';
import { expect, test, vi } from 'vitest';

import PlayerContext from '../../context/player/context';
import SimpleModeContext from '../../context/simple-mode/context';
import SeekBar from './seekbar';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: key => key }),
}));

const playerState = {
  playerstatus: {
    duration: '100',
    elapsed: '10',
    title: 'Song',
  },
};

const renderSeekbar = (simpleMode) => render(
  <SimpleModeContext.Provider value={{ simpleMode }}>
    <PlayerContext.Provider value={{ state: playerState }}>
      <SeekBar />
    </PlayerContext.Provider>
  </SimpleModeContext.Provider>,
);

test('simple mode keeps the progress visible but disables seeking', () => {
  renderSeekbar(true);

  expect(screen.getByRole('slider', {
    name: 'player.seekbar.song-position',
  })).toBeDisabled();
  expect(screen.getByText('0:10')).toBeInTheDocument();
  expect(screen.getByText('1:40')).toBeInTheDocument();
});

test('regular mode shows an enabled seek bar', () => {
  renderSeekbar(false);

  expect(screen.getByRole('slider', {
    name: 'player.seekbar.song-position',
  })).toBeEnabled();
});
