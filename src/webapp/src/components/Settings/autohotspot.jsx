import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Box,
  FormGroup,
  FormControlLabel,
  Grid,
  Link,
} from '@mui/material';

import SettingsSection from './section';
import { SwitchWithLoader } from '../general';

import request from '../../utils/request';

const helpUrl = 'https://github.com/MiczFlor/RPi-Jukebox-RFID/blob/future3/main/documentation/builders/autohotspot.md';

const SettingsAutoHotpot = () => {
  const { t } = useTranslation();
  const [autohotspotStatus, setAutohotspotStatus] = useState('not-installed');
  const [isLoading, setIsLoading] = useState(true);

  const getAutohotspotStatus = async () => {
    const { result, error } = await request('getAutohotspotStatus');

    if(result && result !== 'error') setAutohotspotStatus(result);
    if((result && result === 'error') || error) console.error(error);
  }

  const toggleAutoHotspot = async () => {
    const status = autohotspotStatus === 'active' ? 'inactive' : 'active';
    const action = autohotspotStatus === 'active' ? 'stop' : 'start';

    setIsLoading(true);
    setAutohotspotStatus(status);
    const { result, error } = await request(`${action}Autohotspot`);

    if (error || result === 'error') {
      console.error(`An error occured while performing '${action}AutoHotspot'`);
      await getAutohotspotStatus();
    }

    setIsLoading(false);
  }

  useEffect(() => {
    const fetchAutohotspotStatus = async () => {
      setIsLoading(true);
      await getAutohotspotStatus();
      setIsLoading(false);
    }

    fetchAutohotspotStatus();
  }, []);

  return (
    <SettingsSection
      id="auto-hotspot"
      subheader={
        autohotspotStatus === 'not-installed' &&
        <Box sx={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap' }}>
          {t('settings.autohotspot.not-installed')}
          <Link
            href={helpUrl}
            rel="noreferrer"
            sx={{
              alignItems: 'center',
              display: 'inline-flex',
              marginLeft: 'var(--space-2)',
              minHeight: 'var(--touch-min)',
            }}
            target="_blank"
          >
            {t('settings.autohotspot.why')}
          </Link>
        </Box>
      }
      title={t('settings.autohotspot.title')}
    >
      <Grid container sx={{ flexDirection: 'column' }}>
        <FormGroup>
          <FormControlLabel
            sx={{
              justifyContent: 'space-between',
              marginLeft: '0',
              minHeight: 72,
            }}
            control={
              <SwitchWithLoader
                checked={autohotspotStatus === 'active'}
                disabled={autohotspotStatus === 'not-installed'}
                isLoading={isLoading}
                onChange={() => toggleAutoHotspot()}
              />
            }
            label={t('settings.autohotspot.control-label')}
            labelPlacement="start"
          />
        </FormGroup>
      </Grid>
    </SettingsSection>
  );
};

export default SettingsAutoHotpot;
