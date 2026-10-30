import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Typography,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';

import request from '../../../utils/request';
import SettingsSection from '../section';
import ButtonDialog from './button-dialog';
import { assignedActionLabel } from './labels';

const SettingsMcp23017 = () => {
  const { t } = useTranslation();
  const [settings, setSettings] = useState(null);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState(null);
  const [removeTarget, setRemoveTarget] = useState(null);
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);

  const refresh = useCallback(async () => {
    const { result, error: requestError } = await request('mcp23017Settings');
    if (!mounted.current) return;
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
    };
  }, [refresh]);

  const remove = async () => {
    setBusy(true);
    setError('');
    const { result, error: requestError } = await request(
      'mcp23017ClearButton', { pin: removeTarget.pin });
    if (!mounted.current) return;
    setBusy(false);
    if (requestError) {
      setError(String(requestError));
      return;
    }
    setSettings(result);
    setRemoveTarget(null);
  };

  const save = (result) => {
    setSettings(result);
    setDialog(null);
  };

  if (settings === null) {
    return (
      <SettingsSection id="mcp23017" title={t('settings.mcp23017.title')}>
        {error
          ? <Alert severity="error">{error}</Alert>
          : <CircularProgress size={24} />}
      </SettingsSection>
    );
  }

  const running = settings.state === 'running';
  const actions = settings.actions || [];
  const assigned = settings.pins.filter(entry => entry.assigned);

  return (
    <SettingsSection id="mcp23017" title={t('settings.mcp23017.title')}>
      <Typography variant="body2" color="text.secondary" sx={{ marginBottom: 2 }}>
        {t('settings.mcp23017.description')}
      </Typography>
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

      {assigned.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {t('settings.mcp23017.empty')}
        </Typography>
      ) : (
        assigned.map(entry => (
          <Box
            key={entry.pin}
            sx={{
              alignItems: 'center',
              borderBottom: 1,
              borderColor: 'divider',
              display: 'flex',
              gap: 1,
              paddingY: 1,
              '&:last-child': { borderBottom: 0 },
            }}
          >
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                {entry.name}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {assignedActionLabel(t, entry, actions)}
              </Typography>
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
            </Box>
            <IconButton
              size="large"
              aria-label={t('settings.mcp23017.edit', { pin: entry.name })}
              onClick={() => setDialog({ mode: 'edit', pin: entry.pin })}
              disabled={!running || busy}
            >
              <EditIcon />
            </IconButton>
            <IconButton
              size="large"
              aria-label={t('settings.mcp23017.delete', { pin: entry.name })}
              onClick={() => setRemoveTarget(entry)}
              disabled={!running || busy}
            >
              <DeleteIcon />
            </IconButton>
          </Box>
        ))
      )}

      <Button
        variant="outlined"
        startIcon={<AddIcon />}
        onClick={() => setDialog({ mode: 'add' })}
        disabled={!running || busy}
        sx={{ minHeight: 48, marginTop: 2 }}
      >
        {t('settings.mcp23017.add')}
      </Button>

      {dialog && (
        <ButtonDialog
          mode={dialog.mode}
          pin={dialog.pin}
          settings={settings}
          onClose={() => setDialog(null)}
          onSaved={save}
        />
      )}

      <Dialog open={Boolean(removeTarget)} onClose={() => setRemoveTarget(null)}>
        <DialogTitle>{t('settings.mcp23017.remove-title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {removeTarget
              ? t('settings.mcp23017.remove-text', {
                pin: removeTarget.name,
                action: assignedActionLabel(t, removeTarget, actions),
              })
              : ''}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setRemoveTarget(null)} disabled={busy}>
            {t('settings.mcp23017.cancel')}
          </Button>
          <Button color="error" onClick={remove} disabled={busy}>
            {t('settings.mcp23017.remove')}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsSection>
  );
};

export default SettingsMcp23017;
