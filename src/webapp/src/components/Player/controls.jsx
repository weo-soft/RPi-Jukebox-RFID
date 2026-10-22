import { memo, useContext, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import PlayCircleFilledRoundedIcon from '@mui/icons-material/PlayCircleFilledRounded';
import PauseCircleFilledRoundedIcon from '@mui/icons-material/PauseCircleFilledRounded';
import SkipPreviousRoundedIcon from '@mui/icons-material/SkipPreviousRounded';
import SkipNextRoundedIcon from '@mui/icons-material/SkipNextRounded';
import ShuffleRoundedIcon from '@mui/icons-material/ShuffleRounded';
import RepeatRoundedIcon from '@mui/icons-material/RepeatRounded';
import RepeatOneRoundedIcon from '@mui/icons-material/RepeatOneRounded';

import PlayerContext from '../../context/player/context';
import { useSimpleMode } from '../../context/simple-mode';
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
const PRESS_FEEDBACK_MS = 400;


// A tap leaves no hover state on a touch screen. Keep a short visual press
// response on the button so the action is visible before the player state
// changes.
const FeedbackIconButton = ({
  children,
  onClick,
  sx,
  ...props
}) => {
  const [pressed, setPressed] = useState(false);
  const timer = useRef();

  useEffect(() => () => clearTimeout(timer.current), []);

  const handleClick = (event) => {
    setPressed(true);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setPressed(false), PRESS_FEEDBACK_MS);
    onClick?.(event);
  };

  return (
    <IconButton
      {...props}
      data-pressed={pressed ? 'true' : 'false'}
      onClick={handleClick}
      sx={[
        { transition: 'transform 120ms ease, background-color 120ms ease' },
        ...(Array.isArray(sx) ? sx : [sx]),
        pressed && {
          backgroundColor: ACTIVE_SURFACE,
          transform: 'scale(.94)',
        },
      ]}
    >
      {children}
    </IconButton>
  );
};

const Control = ({ children, label, showLabel }) => (
  <Box
    sx={{
      alignItems: 'center',
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-1)',
      minWidth: 0,
    }}
  >
    {children}
    {showLabel &&
      <Typography
        color="textSecondary"
        noWrap
        sx={{ maxWidth: 'var(--touch-primary)' }}
        variant="timeLabel"
      >
        {label}
      </Typography>
    }
  </Box>
);

// TODO: Should be broken up in sub-modules
const Controls = () => {
  const { t } = useTranslation();
  const { simpleMode } = useSimpleMode();
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

  const playLabel = isPlaying
    ? t('player.controls.pause')
    : t('player.controls.play');

  return (
    <Box
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 'var(--touch-gap)',
        justifyContent: 'center',
      }}
    >

      {!simpleMode &&
        <Control label={t('player.controls.shuffle.label')} showLabel>
          <FeedbackIconButton
            aria-label={labelShuffle()}
            onClick={toggleShuffle}
            sx={toggleStyle(isShuffle)}
            title={labelShuffle()}
          >
            <ShuffleRoundedIcon sx={{ fontSize: 'var(--icon-comfort)' }} />
          </FeedbackIconButton>
        </Control>
      }

      <Control label={t('player.controls.prev')} showLabel={!simpleMode}>
        <FeedbackIconButton
          aria-label={t('player.controls.prev_song')}
          disabled={!songIsScheduled}
          onClick={() => request('prev_song')}
          sx={touchBox('--touch-secondary')}
          title={t('player.controls.prev_song')}
        >
          <SkipPreviousRoundedIcon sx={{ fontSize: 'var(--icon-secondary)' }} />
        </FeedbackIconButton>
      </Control>

      <Control label={playLabel} showLabel={!simpleMode}>
        <FeedbackIconButton
          aria-label={playLabel}
          disabled={!songIsScheduled}
          onClick={() => request(isPlaying ? 'pause' : 'play')}
          sx={touchBox('--touch-primary')}
          title={playLabel}
        >
          {!isPlaying &&
            <PlayCircleFilledRoundedIcon sx={{ fontSize: 'var(--icon-primary)' }} />
          }
          {isPlaying &&
            <PauseCircleFilledRoundedIcon sx={{ fontSize: 'var(--icon-primary)' }} />
          }
        </FeedbackIconButton>
      </Control>

      <Control label={t('player.controls.next')} showLabel={!simpleMode}>
        <FeedbackIconButton
          aria-label={t('player.controls.next_song')}
          disabled={!songIsScheduled}
          onClick={() => request('next_song')}
          sx={touchBox('--touch-secondary')}
          title={t('player.controls.next_song')}
        >
          <SkipNextRoundedIcon sx={{ fontSize: 'var(--icon-secondary)' }} />
        </FeedbackIconButton>
      </Control>

      {!simpleMode &&
        <Control label={t('player.controls.repeat.label')} showLabel>
          <FeedbackIconButton
            aria-label={labelRepeat()}
            onClick={toggleRepeat}
            sx={toggleStyle(isRepeat)}
            title={labelRepeat()}
          >
            {!isSingle &&
              <RepeatRoundedIcon sx={{ fontSize: 'var(--icon-comfort)' }} />
            }
            {isSingle &&
              <RepeatOneRoundedIcon sx={{ fontSize: 'var(--icon-comfort)' }} />
            }
          </FeedbackIconButton>
        </Control>
      }

    </Box>
  );
};

export default memo(Controls);
