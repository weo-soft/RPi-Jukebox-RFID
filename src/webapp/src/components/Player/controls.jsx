import { memo, useContext, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import PlayCircleFilledRoundedIcon from '@mui/icons-material/PlayCircleFilledRounded';
import PauseCircleFilledRoundedIcon from '@mui/icons-material/PauseCircleFilledRounded';
import SkipPreviousRoundedIcon from '@mui/icons-material/SkipPreviousRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import ShuffleRoundedIcon from '@mui/icons-material/ShuffleRounded';
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded';
import RepeatOneRoundedIcon from '@mui/icons-material/RepeatOneRounded';

import PlayerContext from '../../context/player/context';
import request from '../../utils/request';

// The box of a control comes from its token, the icon size from the matching
// icon token; padding would couple the hit area to the icon instead.
const touchBox = (token) => ({
  height: `var(${token})`,
  minHeight: `var(${token})`,
  minWidth: `var(${token})`,
  padding: 0,
  width: `var(${token})`,
});

const ACTIVE_SURFACE = 'rgba(0, 150, 136, .18)';

// TODO: Should be broken up in sub-modules
const Controls = () => {
  const { t } = useTranslation();
  const {
    state,
    setState,
  } = useContext(PlayerContext);

  const {
    isPlaying,
    playerstatus,
    isShuffle,
    isRepeat,
    isSingle,
    songIsScheduled
  } = state;

  const toggleShuffle = () => {
    request('shuffle', { option: 'toggle' });
  }

  const toggleRepeat = () => {
    request('repeat', { option: 'toggle' });
  }

  useEffect(() => {
    setState(currentState => ({
      ...currentState,
      isPlaying: playerstatus?.state === 'play' ? true : false,
      songIsScheduled: playerstatus?.songid ? true : false,
      isShuffle: playerstatus?.random === '1' ? true : false,
      isRepeat: playerstatus?.repeat === '1' ? true : false,
      isSingle: playerstatus?.single === '1' ? true : false,
    }));
  }, [playerstatus, setState]);

  const labelShuffle = () => (
    isShuffle
      ? t('player.controls.shuffle.disable')
      : t('player.controls.shuffle.enable')
  );

  const labelRepeat = () => {
    if (!isRepeat) return t('player.controls.repeat.enable');
    if (isRepeat && !isSingle) return t('player.controls.repeat.enable-single');
    if (isRepeat && isSingle) return t('player.controls.repeat.disable');
  };

  // An active toggle is marked by a filled surface and by its color
  const toggleStyle = (isActive) => ({
    ...touchBox('--touch-comfort'),
    backgroundColor: isActive ? ACTIVE_SURFACE : 'transparent',
    color: isActive ? 'primary.light' : undefined,
  });

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 'var(--touch-gap)',
        justifyContent: 'center',
      }}
    >

      {/* Shuffle */}
      <IconButton
        aria-label={labelShuffle()}
        onClick={toggleShuffle}
        sx={toggleStyle(isShuffle)}
        title={labelShuffle()}
      >
        <ShuffleRoundedIcon sx={{ fontSize: 'var(--icon-comfort)' }} />
      </IconButton>

      {/* Skip to previous song */}
      <IconButton
        aria-label={t('player.controls.prev_song')}
        disabled={!songIsScheduled}
        onClick={() => request('prev_song')}
        sx={touchBox('--touch-secondary')}
        title={t('player.controls.prev_song')}
      >
        <SkipPreviousRoundedIcon sx={{ fontSize: 'var(--icon-secondary)' }} />
      </IconButton>

      {/* Play */}
      {!isPlaying &&
        <IconButton
          aria-label={t('player.controls.play')}
          onClick={() => request('play')}
          disabled={!songIsScheduled}
          sx={touchBox('--touch-primary')}
          title={t('player.controls.play')}
        >
          <PlayCircleFilledRoundedIcon sx={{ fontSize: 'var(--icon-primary)' }} />
        </IconButton>
      }
      {/* Pause */}
      {isPlaying &&
        <IconButton
          aria-label={t('player.controls.pause')}
          onClick={() => request('pause')}
          sx={touchBox('--touch-primary')}
          title={t('player.controls.pause')}
        >
          <PauseCircleFilledRoundedIcon sx={{ fontSize: 'var(--icon-primary)' }} />
        </IconButton>
      }

      {/* Skip to next song */}
      <IconButton
        aria-label={t('player.controls.next_song')}
        disabled={!songIsScheduled}
        onClick={() => request('next_song')}
        sx={touchBox('--touch-secondary')}
        title={t('player.controls.next_song')}
      >
        <SkipNextRoundedIcon sx={{ fontSize: 'var(--icon-secondary)' }} />
      </IconButton>

      {/* Repeat */}
      <IconButton
        aria-label={labelRepeat()}
        onClick={toggleRepeat}
        sx={toggleStyle(isRepeat)}
        title={labelRepeat()}
      >
        {
          !isSingle &&
          <RepeatRoundedIcon sx={{ fontSize: 'var(--icon-comfort)' }} />
        }
        {
          isSingle &&
          <RepeatOneRoundedIcon sx={{ fontSize: 'var(--icon-comfort)' }} />
        }
      </IconButton>

    </Box>
  );
};

export default memo(Controls);
