import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Tab,
  Tabs,
  Typography,
} from '@mui/material';

import request from '../../../utils/request';
import { actionLabel } from './labels';

const LEARN_POLL_MS = 500;

const ButtonDialog = ({ mode, pin, settings, onClose, onSaved }) => {
  const { t } = useTranslation();
  const actions = settings.actions || [];
  const editing = mode === 'edit';
  const current = editing ? settings.pins.find(entry => entry.pin === pin) : null;
  const freePins = settings.pins.filter(entry => !entry.assigned && entry.valid);
  const [tab, setTab] = useState(0);
  const [selectedPin, setSelectedPin] = useState(current ? current.pin : '');
  const [actionId, setActionId] = useState(current?.action_id || '');
  const [learn, setLearn] = useState({ state: 'idle' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const timer = useRef(null);
  const mounted = useRef(true);

  useEffect(() => () => {
    mounted.current = false;
    if (timer.current !== null) {
      clearInterval(timer.current);
    }
  }, []);

  const stopPolling = () => {
    if (timer.current !== null) {
      clearInterval(timer.current);
      timer.current = null;
    }
  };

  const assign = async (targetPin, targetAction) => {
    setBusy(true);
    setError('');
    const { result, error: requestError } = await request(
      'mcp23017SetButton', { pin: targetPin, action_id: targetAction });
    if (requestError) {
      if (mounted.current) {
        setBusy(false);
        setError(String(requestError));
      }
      return;
    }
    if (editing && targetPin !== pin) {
      await request('mcp23017ClearButton', { pin });
    }
    if (!mounted.current) return;
    setBusy(false);
    onSaved(result);
  };

  const pollLearn = async (targetAction) => {
    const { result, error: requestError } = await request('mcp23017LearnState');
    if (!mounted.current) return;
    if (requestError) {
      stopPolling();
      setError(String(requestError));
      setLearn({ state: 'idle' });
      return;
    }
    setLearn(result);
    if (result.state === 'learned') {
      stopPolling();
      await assign(result.pin, targetAction);
    } else if (result.state === 'timeout') {
      stopPolling();
      await request('mcp23017CancelLearn');
    } else if (result.state === 'idle') {
      stopPolling();
    }
  };

  const startLearn = async () => {
    if (!actionId) return;
    setError('');
    setBusy(true);
    const { result, error: requestError } = await request(
      'mcp23017StartLearn', { action_id: actionId });
    if (!mounted.current) return;
    setBusy(false);
    if (requestError) {
      setError(String(requestError));
      return;
    }
    setLearn(result);
    stopPolling();
    pollLearn(actionId);
    timer.current = setInterval(() => pollLearn(actionId), LEARN_POLL_MS);
  };

  const close = async () => {
    stopPolling();
    await request('mcp23017CancelLearn');
    if (mounted.current) onClose();
  };

  const save = () => {
    if (selectedPin === '' || !actionId) return;
    assign(selectedPin, actionId);
  };

  const actionSelect = (
    <FormControl fullWidth size="small">
      <InputLabel id="mcp23017-action-label">
        {t('settings.mcp23017.action')}
      </InputLabel>
      <Select
        labelId="mcp23017-action-label"
        label={t('settings.mcp23017.action')}
        value={actionId}
        onChange={event => setActionId(event.target.value)}
        displayEmpty
      >
        <MenuItem value="" disabled>
          {t('settings.mcp23017.choose-action')}
        </MenuItem>
        {actions.map(action => (
          <MenuItem key={action.id} value={action.id}>
            {actionLabel(t, action)}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );

  return (
    <Dialog open fullWidth maxWidth="sm" onClose={close}>
      <DialogTitle>
        {editing
          ? t('settings.mcp23017.dialog-edit-title')
          : t('settings.mcp23017.dialog-add-title')}
      </DialogTitle>
      <DialogContent>
        <Tabs
          value={tab}
          onChange={(_event, value) => setTab(value)}
          sx={{ marginBottom: 2 }}
        >
          <Tab label={t('settings.mcp23017.mode-direct')} />
          <Tab label={t('settings.mcp23017.mode-learn')} />
        </Tabs>
        {error && (
          <Alert severity="error" sx={{ marginBottom: 2 }}>
            {error}
          </Alert>
        )}

        {tab === 0 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {editing ? (
              <Typography variant="body2">
                {t('settings.mcp23017.pin')}: <strong>{current?.name}</strong>
              </Typography>
            ) : (
              <FormControl fullWidth size="small">
                <InputLabel id="mcp23017-pin-label">
                  {t('settings.mcp23017.pin')}
                </InputLabel>
                <Select
                  labelId="mcp23017-pin-label"
                  label={t('settings.mcp23017.pin')}
                  value={selectedPin}
                  onChange={event => setSelectedPin(event.target.value)}
                >
                  {freePins.map(entry => (
                    <MenuItem key={entry.pin} value={entry.pin}>
                      {entry.name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
            {actionSelect}
            {editing && current?.advanced && (
              <Alert severity="warning">
                {t('settings.mcp23017.advanced-edit', { type: current.type })}
              </Alert>
            )}
            {!editing && freePins.length === 0 && (
              <Alert severity="warning">
                {t('settings.mcp23017.no-free-pins')}
              </Alert>
            )}
          </Box>
        )}

        {tab === 1 && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <Typography variant="body2" color="text.secondary">
              {t('settings.mcp23017.learn-description')}
            </Typography>
            {actionSelect}
            <Box sx={{ alignItems: 'center', display: 'flex', gap: 1, flexWrap: 'wrap' }}>
              <Button
                variant="contained"
                onClick={startLearn}
                disabled={!actionId || busy || learn.state === 'waiting'}
              >
                {t('settings.mcp23017.learn-start')}
              </Button>
              {learn.state === 'waiting' && (
                <>
                  <CircularProgress size={18} />
                  <Typography variant="body2">
                    {t('settings.mcp23017.learn-waiting')}
                  </Typography>
                </>
              )}
            </Box>
            {learn.state === 'timeout' && (
              <Alert severity="warning">
                {t('settings.mcp23017.learn-timeout')}
              </Alert>
            )}
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={close} disabled={busy}>
          {t('settings.mcp23017.cancel')}
        </Button>
        {tab === 0 && (
          <Button
            variant="contained"
            onClick={save}
            disabled={busy || selectedPin === '' || !actionId}
          >
            {t('settings.mcp23017.save')}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default ButtonDialog;
