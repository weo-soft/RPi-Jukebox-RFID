import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CardHeader,
  CircularProgress,
  Divider,
  FormControl,
  Grid,
  MenuItem,
  Select,
  Typography,
} from '@mui/material';

import request from '../../../utils/request';

const LEARN_POLL_MS = 500;

const SettingsMcp23017 = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [learnAction, setLearnAction] = useState('play_pause');
  const [learnState, setLearnState] = useState({ state: 'idle' });
  const pollTimer = useRef(null);
  const mounted = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollTimer.current !== null) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  }, []);

  const refresh = useCallback(async () => {
    const { result, error: requestError } = await request('mcp23017Settings');
    if (requestError) {
      setError(String(requestError));
      return;
    }
    setSettings(result);
  }, []);

  useEffect(() => {
    mounted.current = true;
    refresh();
    return () => {
      mounted.current = false;
      stopPolling();
    };
  }, [refresh, stopPolling]);

  const assignLearned = useCallback(async (pin, actionId) => {
    setBusy(true);
    const { result, error: requestError } = await request(
      'mcp23017SetButton', { pin, action_id: actionId });
    await request('mcp23017CancelLearn');
    setBusy(false);
    if (!mounted.current) return;
    if (requestError) {
      setError(String(requestError));
      return;
    }
    setSettings(result);
  }, []);

  const pollLearn = useCallback(async (actionId) => {
    const { result, error: requestError } = await request('mcp23017LearnState');
    if (!mounted.current) return;
    if (requestError) {
      stopPolling();
      setError(String(requestError));
      setLearnState({ state: 'idle' });
      return;
    }
    setLearnState(result);
    if (result.state === 'learned') {
      stopPolling();
      await assignLearned(result.pin, result.action_id || actionId);
    } else if (result.state === 'timeout') {
      stopPolling();
      await request('mcp23017CancelLearn');
    } else if (result.state === 'idle') {
      stopPolling();
    }
  }, [assignLearned, stopPolling]);

  const startLearn = async () => {
    setError('');
    setBusy(true);
    const { result, error: requestError } = await request(
      'mcp23017StartLearn', { action_id: learnAction });
    setBusy(false);
    if (!mounted.current) return;
    if (requestError) {
      setError(String(requestError));
      return;
    }
    setLearnState(result);
    stopPolling();
    pollLearn(learnAction);
    pollTimer.current = setInterval(() => pollLearn(learnAction), LEARN_POLL_MS);
  };

  const cancelLearn = async () => {
    stopPolling();
    await request('mcp23017CancelLearn');
    if (mounted.current) setLearnState({ state: 'idle' });
  };

  const applyAssignment = async (pin, actionId) => {
    setError('');
    setBusy(true);
    const { result, error: requestError } = actionId
      ? await request('mcp23017SetButton', { pin, action_id: actionId })
      : await request('mcp23017ClearButton', { pin });
    setBusy(false);
    if (!mounted.current) return;
    if (requestError) {
      setError(String(requestError));
      return;
    }
    setSettings(result);
  };

  const actionLabel = (action) => {
    const label = t(`settings.mcp23017.actions.${action.id}`, { defaultValue: action.label });
    return action.danger ? `${label} ⚠` : label;
  };

  if (settings === null) {
    return (
      <Card>
        <CardHeader title={t('settings.mcp23017.title')} />
        <Divider />
        <CardContent>
          {error
            ? <Alert severity="error">{error}</Alert>
            : <CircularProgress size={24} />}
        </CardContent>
      </Card>
    );
  }

  const running = settings.state === 'running';
  const actions = settings.actions || [];
  const pins = settings.pins || [];
  const learnedPin = pins.find(entry => entry.pin === learnState.pin);

  return (
    <Card>
      <CardHeader
        title={t('settings.mcp23017.title')}
        subheader={t('settings.mcp23017.description')}
      />
      <Divider />
      <CardContent>
        {!running && (
          <Alert severity="warning" sx={{ marginBottom: 2 }}>
            {t('settings.mcp23017.not-running', { state: settings.state })}
            {settings.last_error ? `: ${settings.last_error}` : ''}
          </Alert>
        )}
        {error && (
          <Alert severity="error" sx={{ marginBottom: 2 }} onClose={() => setError('')}>
            {error}
          </Alert>
        )}

        <Typography variant="subtitle2" sx={{ marginBottom: 1 }}>
          {t('settings.mcp23017.assignment-title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ marginBottom: 2 }}>
          {t('settings.mcp23017.assignment-description')}
        </Typography>

        <Grid container spacing={1} sx={{ marginBottom: 3 }}>
          {pins.map(entry => (
            <Grid key={entry.pin} size={{ xs: 12, sm: 6 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography
                  sx={{ width: 48, fontFamily: 'monospace', flexShrink: 0 }}
                  variant="body2"
                >
                  {entry.name}
                </Typography>
                <FormControl size="small" fullWidth>
                  <Select
                    value={entry.action_id || ''}
                    onChange={event => applyAssignment(entry.pin, event.target.value)}
                    disabled={!running || busy}
                    displayEmpty
                  >
                    <MenuItem value="">{t('settings.mcp23017.unassigned')}</MenuItem>
                    {actions.map(action => (
                      <MenuItem key={action.id} value={action.id}>
                        {actionLabel(action)}
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </Box>
              {entry.advanced && (
                <Typography variant="caption" color="warning.main">
                  {t('settings.mcp23017.advanced', { type: entry.type })}
                </Typography>
              )}
              {!entry.valid && entry.error && (
                <Typography variant="caption" color="error">
                  {entry.error}
                </Typography>
              )}
            </Grid>
          ))}
        </Grid>

        <Divider sx={{ marginBottom: 2 }} />
        <Typography variant="subtitle2" sx={{ marginBottom: 1 }}>
          {t('settings.mcp23017.learn-title')}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ marginBottom: 2 }}>
          {t('settings.mcp23017.learn-description')}
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 200 }}>
            <Select
              value={learnAction}
              onChange={event => setLearnAction(event.target.value)}
              disabled={!running || busy || learnState.state === 'waiting'}
            >
              {actions.map(action => (
                <MenuItem key={action.id} value={action.id}>
                  {actionLabel(action)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            onClick={startLearn}
            disabled={!running || busy || learnState.state === 'waiting'}
          >
            {t('settings.mcp23017.learn-start')}
          </Button>
          {learnState.state === 'waiting' && (
            <>
              <CircularProgress size={18} />
              <Typography variant="body2">
                {t('settings.mcp23017.learn-waiting')}
              </Typography>
              <Button size="small" onClick={cancelLearn}>
                {t('settings.mcp23017.learn-cancel')}
              </Button>
            </>
          )}
        </Box>

        {learnState.state === 'learned' && learnedPin && (
          <Alert severity="success" sx={{ marginTop: 2 }}>
            {t('settings.mcp23017.learn-done', { pin: learnedPin.name })}
          </Alert>
        )}
        {learnState.state === 'timeout' && (
          <Alert severity="warning" sx={{ marginTop: 2 }}>
            {t('settings.mcp23017.learn-timeout')}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
};

export default SettingsMcp23017;
