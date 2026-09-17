import { useContext, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import Slider from '@mui/material/Slider';
import Typography from '@mui/material/Typography';
import VolumeDownIcon from '@mui/icons-material/VolumeDown';
import VolumeMuteIcon from '@mui/icons-material/VolumeMute';
import VolumeOffIcon from '@mui/icons-material/VolumeOff';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';

import PubSubContext from '../../context/pubsub/context';
import request from '../../utils/request';

const Volume = () => {
  const { t } = useTranslation();
  const { state } = useContext(PubSubContext);
  const { 'volume.level': { volume, mute } = {} } = state;

  const [isChangingVolume, setIsChangingVolume] = useState(false);
  const [_volume, setVolume] = useState(0);
  const [volumeMute, setVolumeMute] = useState(false);
  const [maxVolume, setMaxVolume] = useState(100);
  const [volumeStep] = useState(1);

  const toggleVolumeMute = () => {
    setVolumeMute(!volumeMute);
    request('toggleMuteVolume', { mute: !volumeMute });
  };

  const updateVolume = () => {
    request('setVolume', { volume: _volume });
    // Delay the next command to avoid jumping slide control
    setTimeout(() => setIsChangingVolume(false), 500);
  }

  const handleVolumeChange = (event, newVolume) => {
    setIsChangingVolume(true);
    if (newVolume <= maxVolume) {
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
    <Box
      data-testid="volume-row"
      sx={{
        alignItems: 'center',
        display: 'flex',
        gap: 'var(--space-2)',
        width: '100%',
      }}
    >
      <IconButton
        aria-label={labelIcon()}
        onClick={toggleVolumeMute}
        sx={{
          height: 'var(--touch-comfort)',
          minHeight: 'var(--touch-comfort)',
          minWidth: 'var(--touch-comfort)',
          padding: 0,
          width: 'var(--touch-comfort)',
        }}
        title={labelIcon()}
      >
        {volumeMute &&
          <VolumeOffIcon sx={{ fontSize: 'var(--icon-comfort)' }} />}
        {!volumeMute && _volume === 0 &&
          <VolumeMuteIcon sx={{ fontSize: 'var(--icon-comfort)' }} />}
        {!volumeMute && _volume > 0 && _volume < 50 &&
          <VolumeDownIcon sx={{ fontSize: 'var(--icon-comfort)' }} />}
        {!volumeMute && _volume >= 50 &&
          <VolumeUpIcon sx={{ fontSize: 'var(--icon-comfort)' }} />}
      </IconButton>
      <Box sx={{ minWidth: 0, width: '100%' }}>
        <Slider
          aria-labelledby={t('player.volume.slider')}
          disabled={!!volumeMute}
          getAriaValueText={(value) => `${value}%`}
          marks={[ { value: maxVolume } ]}
          onChange={handleVolumeChange}
          onChangeCommitted={updateVolume}
          step={volumeStep}
          value={_volume}
          valueLabelDisplay="auto"
        />
      </Box>
      <Typography
        aria-hidden="true"
        color="textSecondary"
        sx={{ minWidth: 48, textAlign: 'right' }}
        variant="timeLabel"
      >
        {_volume}
      </Typography>
    </Box>
  );
}

export default Volume;
