import {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  Divider,
  FormControl,
  FormControlLabel,
  Grid,
  InputLabel,
  MenuItem,
  Select,
  Slider,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

import PubSubContext from '../../../context/pubsub/context';
import request from '../../../utils/request';

const STATE_LABELS = {
  active: 'state-active',
  dimmed: 'state-dimmed',
  standby: 'state-standby',
};

const SOURCE_LABELS = {
  sysfs: 'source-sysfs',
  ddc: 'source-ddc',
  x11: 'source-x11',
};

const SettingsDisplay = () => {
  const { t } = useTranslation();
  const { state: publisherState = {} } = useContext(PubSubContext);
  const published = publisherState['display.status'];

  const hasPublishedStatus = useRef(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [brightness, setBrightness] = useState(100);
  const [dimBrightness, setDimBrightness] = useState(10);
  const [dimTimeout, setDimTimeout] = useState(2);
  const [standbyTimeout, setStandbyTimeout] = useState(5);

  const applyStatus = useCallback((next) => {
    if (!next || typeof next !== 'object') {
      return;
    }
    setStatus(next);
    setBrightness(next.brightness_percent ?? 100);
    setDimBrightness(next.dim_brightness_percent ?? 10);
    setDimTimeout(next.dim_timeout_min ?? 2);
    setStandbyTimeout(next.standby_timeout_min ?? 5);
    setError(null);
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      const { result, error: requestError } = await request('displayStatus');
      if (!active) {
        return;
      }
      if (requestError) {
        setError(requestError);
        return;
      }
      if (!hasPublishedStatus.current) {
        applyStatus(result);
      }
    })();
    return () => {
      active = false;
    };
  }, [applyStatus]);

  useEffect(() => {
    if (published) {
      hasPublishedStatus.current = true;
      applyStatus(published);
    }
  }, [applyStatus, published]);

  const send = async (command, kwargs) => {
    const { result, error: requestError } = await request(command, kwargs);
    if (requestError) {
      setError(requestError);
      return;
    }
    applyStatus(result);
  };

  const errors = status?.errors || [];
  const noControl = errors.includes('no_display_control');
  const dimAvailable = status?.dim_available === true;
  const source = status?.brightness_source;
  const stateKey = status?.state;

  if (noControl || (!status && error)) {
    return (
      <Card id="display">
        <CardHeader title={t('settings.display.title')} />
        <Divider />
        <CardContent>
          <Alert severity="warning">
            {t('settings.display.unavailable')}
            {error ? ` (${error})` : ''}
          </Alert>
        </CardContent>
      </Card>
    );
  }

  const commitTimeouts = () => {
    send('displaySetTimeouts', {
      dim_min: Math.max(0, Number(dimTimeout) || 0),
      standby_min: Math.max(0, Number(standbyTimeout) || 0),
    });
  };

  return (
    <Card id="display">
      <CardHeader title={t('settings.display.title')} />
      <Divider />
      <CardContent>
        <Grid container sx={{ flexDirection: 'column' }} spacing={2}>
          <Grid size={12}>
            <Typography variant="body2">
              {t('settings.display.state')}:{' '}
              {t(`settings.display.${STATE_LABELS[stateKey] || 'state-active'}`)}
              {' · '}
              {t('settings.display.source')}:{' '}
              {t(`settings.display.${SOURCE_LABELS[source] || 'source-none'}`)}
            </Typography>
            {status?.backlight_device ? (
              <Typography variant="caption" display="block">
                {t('settings.display.device')}: {status.backlight_device}
              </Typography>
            ) : null}
            {status?.busy ? (
              <Typography variant="caption" display="block">
                {t('settings.display.busy')}
              </Typography>
            ) : null}
          </Grid>

          <Grid size={12}>
            <Typography>{t('settings.display.brightness')}</Typography>
            <Slider
              aria-label={t('settings.display.brightness')}
              data-testid="display-brightness"
              disabled={!dimAvailable}
              min={1}
              max={100}
              step={1}
              value={brightness}
              onChange={(event, value) => setBrightness(value)}
              onChangeCommitted={(event, value) => send(
                'displaySetBrightness',
                { percent: Math.round(value) },
              )}
              valueLabelDisplay="auto"
            />
          </Grid>

          <Grid size={12}>
            <Typography>{t('settings.display.dim-brightness')}</Typography>
            <Slider
              aria-label={t('settings.display.dim-brightness')}
              data-testid="display-dim-brightness"
              disabled={!dimAvailable}
              min={0}
              max={100}
              step={1}
              value={dimBrightness}
              onChange={(event, value) => setDimBrightness(value)}
              onChangeCommitted={(event, value) => send(
                'displaySetDimBrightness',
                { percent: Math.round(value) },
              )}
              valueLabelDisplay="auto"
            />
          </Grid>

          <Grid size={12}>
            <TextField
              label={t('settings.display.dim-timeout')}
              data-testid="display-dim-timeout"
              type="number"
              fullWidth
              disabled={!dimAvailable}
              value={dimTimeout}
              onChange={(event) => setDimTimeout(event.target.value)}
              onBlur={commitTimeouts}
              slotProps={{ htmlInput: { min: 0, max: 1440 } }}
            />
          </Grid>

          <Grid size={12}>
            <TextField
              label={t('settings.display.standby-timeout')}
              data-testid="display-standby-timeout"
              type="number"
              fullWidth
              value={standbyTimeout}
              onChange={(event) => setStandbyTimeout(event.target.value)}
              onBlur={commitTimeouts}
              slotProps={{ htmlInput: { min: 0, max: 1440 } }}
            />
          </Grid>

          <Grid size={12}>
            <FormControl fullWidth>
              <InputLabel id="display-music-mode-label">
                {t('settings.display.music-mode')}
              </InputLabel>
              <Select
                labelId="display-music-mode-label"
                label={t('settings.display.music-mode')}
                data-testid="display-music-mode"
                value={status?.music_mode || 'normal'}
                onChange={(event) => send(
                  'displaySetMusicMode',
                  { mode: event.target.value },
                )}
              >
                <MenuItem value="normal">
                  {t('settings.display.music-mode-normal')}
                </MenuItem>
                <MenuItem value="on_while_playing">
                  {t('settings.display.music-mode-on')}
                </MenuItem>
                <MenuItem value="dim_while_playing">
                  {t('settings.display.music-mode-dim')}
                </MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid size={12}>
            <FormControl fullWidth>
              <InputLabel id="display-mechanic-label">
                {t('settings.display.standby-mechanic')}
              </InputLabel>
              <Select
                labelId="display-mechanic-label"
                label={t('settings.display.standby-mechanic')}
                data-testid="display-standby-mechanic"
                value={status?.standby_mechanic || 'auto'}
                onChange={(event) => send(
                  'displaySetStandbyMechanic',
                  { mechanic: event.target.value },
                )}
              >
                <MenuItem value="auto">
                  {t('settings.display.standby-mechanic-auto')}
                </MenuItem>
                <MenuItem value="backlight" disabled={!dimAvailable}>
                  {t('settings.display.standby-mechanic-backlight')}
                </MenuItem>
                <MenuItem value="power_off">
                  {t('settings.display.standby-mechanic-power-off')}
                </MenuItem>
              </Select>
            </FormControl>
          </Grid>

          <Grid size={12}>
            <FormControlLabel
              control={(
                <Switch
                  checked={status?.power !== false}
                  onChange={(event) => send(
                    'displaySetPower',
                    { on: event.target.checked },
                  )}
                />
              )}
              label={t('settings.display.power')}
            />
          </Grid>

          {errors.includes('no_backlight_device') ? (
            <Grid size={12}>
              <Alert severity="info">
                {t('settings.display.no-backlight')}
              </Alert>
            </Grid>
          ) : null}

          {source === 'x11' ? (
            <Grid size={12}>
              <Alert severity="info">
                {t('settings.display.software-dim')}
              </Alert>
            </Grid>
          ) : null}

          {errors.includes('no_input_access') ? (
            <Grid size={12}>
              <Alert severity="info">
                {t('settings.display.no-input')}
              </Alert>
            </Grid>
          ) : null}

          {error ? (
            <Grid size={12}>
              <Alert severity="error">{error}</Alert>
            </Grid>
          ) : null}

          {errors.length ? (
            <Grid size={12}>
              <Typography variant="caption">
                {t('settings.display.errors')}: {errors.join(', ')}
              </Typography>
            </Grid>
          ) : null}
        </Grid>
      </CardContent>
    </Card>
  );
};

export default SettingsDisplay;
