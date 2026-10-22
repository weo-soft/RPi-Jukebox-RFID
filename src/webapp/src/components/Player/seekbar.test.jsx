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

test('simple mode hides the seek bar', () => {
  renderSeekbar(true);

  expect(screen.queryByRole('slider', {
    name: 'player.seekbar.song-position',
  })).not.toBeInTheDocument();
});

test('regular mode shows the seek bar', () => {
  renderSeekbar(false);

  expect(screen.getByRole('slider', {
    name: 'player.seekbar.song-position',
  })).toBeInTheDocument();
});
