import React, { useEffect, useState } from 'react';
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
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

import request from '../../../utils/request';

const SECRET_PLACEHOLDER = '***';

/**
 * Map config_schema field types to React components.
 */
const FIELD_COMPONENTS = {
  string: ({ field, value, onChange }) => (
    <TextField
      fullWidth
      label={field.label}
      helperText={field.description}
      placeholder={field.placeholder}
      required={field.required}
      value={value ?? field.default ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
      margin="normal"
    />
  ),

  number: ({ field, value, onChange }) => (
    <TextField
      fullWidth
      type="number"
      label={field.label}
      helperText={field.description}
      required={field.required}
      value={value ?? field.default ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
      margin="normal"
      inputProps={{
        min: field.validation?.min,
        max: field.validation?.max,
        step: 'any',
      }}
    />
  ),

  integer: ({ field, value, onChange }) => (
    <TextField
      fullWidth
      type="number"
      label={field.label}
      helperText={field.description}
      required={field.required}
      value={value ?? field.default ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
      margin="normal"
      inputProps={{
        min: field.validation?.min,
        max: field.validation?.max,
        step: 1,
      }}
    />
  ),

  boolean: ({ field, value, onChange }) => (
    <FormControlLabel
      control={
        <Switch
          checked={!!value}
          onChange={(e) => onChange(field.key, e.target.checked)}
        />
      }
      label={field.label}
      sx={{ mt: 1, mb: 1 }}
    />
  ),

  select: ({ field, value, onChange }) => (
    <TextField
      fullWidth
      select
      label={field.label}
      helperText={field.description}
      required={field.required}
      value={value ?? field.default ?? ''}
      onChange={(e) => onChange(field.key, e.target.value)}
      margin="normal"
    >
      {(field.options || []).map((opt) => (
        <MenuItem key={opt.value} value={opt.value}>
          {opt.label}
        </MenuItem>
      ))}
    </TextField>
  ),
};

const PluginSettings = () => {
  const { t } = useTranslation();
  const [schemas, setSchemas] = useState([]);
  const [configs, setConfigs] = useState({});
  const [dirty, setDirty] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const [messages, setMessages] = useState({});

  // Load schemas and current config on mount
  useEffect(() => {
    const load = async () => {
      setLoading(true);
      const { result: s } = await request('getPluginSchemas');
      const { result: c } = await request('getPluginConfigs');
      if (s) setSchemas(s);
      if (c) {
        setConfigs(c);
        setDirty(JSON.parse(JSON.stringify(c)));
      }
      setLoading(false);
    };
    load();
  }, []);

  const handleChange = (configKey, fieldKey, value) => {
    setDirty((prev) => ({
      ...prev,
      [configKey]: { ...prev[configKey], [fieldKey]: value },
    }));
    setMessages((prev) => ({ ...prev, [configKey]: null }));
  };

  const isDirty = (configKey) =>
    JSON.stringify(configs[configKey]) !== JSON.stringify(dirty[configKey]);

  const handleSave = async (configKey) => {
    setSaving((prev) => ({ ...prev, [configKey]: true }));

    const schema = schemas.find((s) => s.config_key === configKey);
    const sensitiveFields = new Set(
      (schema?.fields || [])
        .filter((f) => f.sensitive)
        .map((f) => f.key)
    );

    const nonSensitiveChanges = {};
    const secretPromises = [];
    const current = configs[configKey] || {};
    const changed = dirty[configKey] || {};

    for (const key of Object.keys(changed)) {
      if (changed[key] !== current[key]) {
        if (sensitiveFields.has(key)) {
          if (changed[key] !== SECRET_PLACEHOLDER) {
            secretPromises.push(
              request('setPluginSecret', {
                plugin_name: configKey,
                key,
                value: changed[key],
              })
            );
          }
        } else {
          nonSensitiveChanges[key] = changed[key];
        }
      }
    }

    let hasError = false;

    if (Object.keys(nonSensitiveChanges).length > 0) {
      const { result } = await request('setPluginConfig', {
        plugin_name: configKey,
        config: nonSensitiveChanges,
      });
      if (result?.errors?.length) {
        setMessages((prev) => ({
          ...prev,
          [configKey]: { severity: 'error', text: result.errors.join('; ') },
        }));
        hasError = true;
      }
    }

    const secretResults = await Promise.all(secretPromises);
    for (const res of secretResults) {
      if (res.result && !res.result.success) {
        setMessages((prev) => ({
          ...prev,
          [configKey]: {
            severity: 'error',
            text: res.result.error || 'Secret save failed',
          },
        }));
        hasError = true;
      }
    }

    if (!hasError) {
      const { result: fresh } = await request('getPluginConfigs');
      if (fresh) {
        setConfigs(fresh);
        setDirty(JSON.parse(JSON.stringify(fresh)));
      }
      setMessages((prev) => ({
        ...prev,
        [configKey]: {
          severity: 'success',
          text: t('settings.plugins.saved-restart-required'),
        },
      }));
    }
    setSaving((prev) => ({ ...prev, [configKey]: false }));
  };

  const handleReset = (configKey) => {
    setDirty((prev) => ({
      ...prev,
      [configKey]: JSON.parse(JSON.stringify(configs[configKey] || {})),
    }));
    setMessages((prev) => ({ ...prev, [configKey]: null }));
  };

  if (loading) {
    return (
      <Card>
        <CardContent sx={{ textAlign: 'center', py: 4 }}>
          <CircularProgress />
        </CardContent>
      </Card>
    );
  }

  if (schemas.length === 0) return null;

  return (
    <>
      {schemas.map((schema) => {
        const ck = schema.config_key;
        const cfg = dirty[ck] || {};

        return (
          <Card key={ck} sx={{ mb: 2 }}>
            <CardHeader
              title={schema.display_name || ck}
              subheader={schema.description}
            />
            <Divider />
            <CardContent>
              <Grid container direction="column" spacing={1}>
                {(schema.fields || []).map((field) => {
                  const Comp = FIELD_COMPONENTS[field.type];
                  if (!Comp) {
                    return (
                      <Typography key={field.key} color="error">
                        Unknown type: {field.type}
                      </Typography>
                    );
                  }
                  let val = cfg[field.key];
                  if (field.sensitive && val === SECRET_PLACEHOLDER)
                    val = '';

                  return (
                    <Grid item key={field.key}>
                      <Comp
                        field={field}
                        value={val}
                        onChange={(k, v) => handleChange(ck, k, v)}
                      />
                    </Grid>
                  );
                })}

                {messages[ck] && (
                  <Grid item>
                    <Alert severity={messages[ck].severity}>
                      {messages[ck].text}
                    </Alert>
                  </Grid>
                )}

                <Grid item>
                  <Box sx={{ display: 'flex', gap: 1, mt: 1 }}>
                    <Button
                      variant="contained"
                      disabled={!isDirty(ck) || saving[ck]}
                      onClick={() => handleSave(ck)}
                    >
                      {saving[ck]
                        ? t('settings.plugins.saving')
                        : t('settings.plugins.save')}
                    </Button>
                    <Button
                      variant="outlined"
                      disabled={!isDirty(ck) || saving[ck]}
                      onClick={() => handleReset(ck)}
                    >
                      {t('settings.plugins.reset')}
                    </Button>
                  </Box>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        );
      })}
    </>
  );
};

export default PluginSettings;