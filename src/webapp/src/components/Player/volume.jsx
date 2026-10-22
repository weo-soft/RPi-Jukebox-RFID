import { useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

import AddIcon from '@mui/icons-material/Add';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import RemoveIcon from '@mui/icons-material/Remove';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeMuteIcon from '@mui/icons-material/VolumeMute';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';

import PubSubContext from '../../context/pubsub/context';
import request from '../../utils/request';
import { nextVolume, VOLUME_STEP } from './volume-step';

const FEEDBACK_MS = 1200;

const touchBox = {
  height: 'var(--touch-volume)',
  minHeight: 'var(--touch-volume)',
  minWidth: 'var(--touch-volume)',
  padding: 0,
  width: 'var(--touch-volume)',
};

const FeedbackIcon = ({ feedback }) => {
  if (feedback.kind === 'muted') {
    return <VolumeOffIcon sx={{ fontSize: 'var(--icon-primary)' }} />;
  }
  if (feedback.kind === 'sound') {
    return <VolumeUpIcon sx={{ fontSize: 'var(--icon-primary)' }} />;
  }
  if (feedback.value < 50) {
    return <VolumeDownIcon sx={{ fontSize: 'var(--icon-primary)' }} />;
  }
  return <VolumeUpIcon sx={{ fontSize: 'var(--icon-primary)' }} />;
};

const Volume = () => {
  const { t } = useTranslation();
  const { state } = useContext(PubSubContext);
  const { 'volume.level': { volume, mute } = {} } = state;

  const [isChangingVolume, setIsChangingVolume] = useState(false);
  const [_volume, setVolume] = useState(0);
  const [volumeMute, setVolumeMute] = useState(false);
  const [maxVolume, setMaxVolume] = useState(100);
  const [feedback, setFeedback] = useState(null);
  const feedbackTimer = useRef();

  const max = Number.isFinite(Number(maxVolume)) ? Number(maxVolume) : 100;

  const showFeedback = (nextFeedback) => {
    setFeedback(nextFeedback);
    clearTimeout(feedbackTimer.current);
    feedbackTimer.current = setTimeout(() => setFeedback(null), FEEDBACK_MS);
  };

  useEffect(() => () => clearTimeout(feedbackTimer.current), []);

  const changeVolumeBy = (delta) => {
    const current = Number(_volume) || 0;
    const next = nextVolume(current, delta, max);
    if (next === current) return;

    setVolume(next);
    setVolumeMute(next === 0);
    request('setVolume', { volume: next });
    showFeedback({ kind: next === 0 ? 'muted' : 'volume', value: next });
  };

  const toggleVolumeMute = () => {
    const nextMute = !volumeMute;
    setVolumeMute(nextMute);
    request('toggleMuteVolume', { mute: nextMute });
    showFeedback({ kind: nextMute ? 'muted' : 'sound' });
  };

  const updateVolume = () => {
    request('setVolume', { volume: _volume });
    setVolumeMute(_volume === 0);
    showFeedback({ kind: _volume === 0 ? 'muted' : 'volume', value: _volume });
    // Delay the next command to avoid jumping slide control
    setTimeout(() => setIsChangingVolume(false), 500);
  }

  const handleVolumeChange = (event, newVolume) => {
    setIsChangingVolume(true);
    if (newVolume <= max) {
      setVolume(newVolume);
    }
  }

  useEffect(() => {
    // Only trigger API when not dragging volume bar
    if (volume !== undefined && mute !== undefined && !isChangingVolume) {
      setVolume(volume);
      setVolumeMute(!!mute);
    }
  }, [isChangingVolume, volume, mute]);

  useEffect(() => {
    const fetchVolume = async () =>  {
      const { result } = await request('getVolume');
      setVolume(result);
    }

    const fetchMaxVolume = async () =>  {
      const { result } = await request('getMaxVolume');
      setMaxVolume(result);
    }

    fetchVolume();
    fetchMaxVolume();
  }, []);

  const labelIcon = () => (
    volumeMute
      ? t('player.volume.unmute')
      : t('player.volume.mute')
  );

  return (
    <>
      <Box
        data-testid="volume-row"
        sx={{
          alignItems: 'center',
          display: 'grid',
          gap: 'var(--space-2)',
          gridTemplateColumns: 'auto auto minmax(0, 1fr) auto auto',
          width: '100%',
        }}
      >
        <IconButton
          aria-label={labelIcon()}
          onClick={toggleVolumeMute}
          sx={touchBox}
          title={labelIcon()}
        >
          {volumeMute &&
            <VolumeOffIcon sx={{ fontSize: 'var(--icon-volume)' }} />}
          {!volumeMute && _volume === 0 &&
            <VolumeMuteIcon sx={{ fontSize: 'var(--icon-volume)' }} />}
          {!volumeMute && _volume > 0 && _volume < 50 &&
            <VolumeDownIcon sx={{ fontSize: 'var(--icon-volume)' }} />}
          {!volumeMute && _volume >= 50 &&
            <VolumeUpIcon sx={{ fontSize: 'var(--icon-volume)' }} />}
        </IconButton>
        <IconButton
          aria-label={t('player.volume.decrease')}
          data-testid="volume-decrease"
          disabled={_volume <= 0}
          onClick={() => changeVolumeBy(-VOLUME_STEP)}
          sx={touchBox}
          title={t('player.volume.decrease')}
        >
          <RemoveIcon sx={{ fontSize: 'var(--icon-volume)' }} />
        </IconButton>
        <Box sx={{ minWidth: 0, width: '100%' }}>
          <Slider
            aria-label={t('player.volume.slider')}
            disabled={!!volumeMute}
            getAriaValueText={(value) => `${value}%`}
            marks={[ { value: max } ]}
            onChange={handleVolumeChange}
            onChangeCommitted={updateVolume}
            step={1}
            value={_volume}
            valueLabelDisplay="auto"
          />
        </Box>
        <IconButton
          aria-label={t('player.volume.increase')}
          data-testid="volume-increase"
          disabled={_volume >= max}
          onClick={() => changeVolumeBy(VOLUME_STEP)}
          sx={touchBox}
          title={t('player.volume.increase')}
        >
          <AddIcon sx={{ fontSize: 'var(--icon-volume)' }} />
        </IconButton>
        <Typography
          aria-hidden="true"
          color="textSecondary"
          data-testid="volume-value"
          sx={{ minWidth: 48, textAlign: 'right' }}
          variant="timeLabel"
        >
          {_volume}
        </Typography>
      </Box>
      {feedback && createPortal(
        <Box
          aria-live="polite"
          data-testid="volume-feedback"
          role="status"
          sx={{
            alignItems: 'center',
            backgroundColor: 'rgba(0, 0, 0, .82)',
            borderRadius: 'var(--radius-md)',
            color: 'common.white',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-2)',
            left: '50%',
            minWidth: 160,
            padding: 'var(--space-4) var(--space-6)',
            pointerEvents: 'none',
            position: 'fixed',
            textAlign: 'center',
            top: '50%',
            transform: 'translate(-50%, -50%)',
            zIndex: 2000,
          }}
        >
          <FeedbackIcon feedback={feedback} />
          <Typography sx={{ color: 'common.white' }} variant="displayTitle">
            {feedback.kind === 'volume'
              ? `${feedback.value} %`
              : t(`player.volume.${feedback.kind === 'muted' ? 'muted' : 'sound-on'}`)}
          </Typography>
        </Box>,
        document.body,
      )}
    </>
  );
}

export default Volume;
