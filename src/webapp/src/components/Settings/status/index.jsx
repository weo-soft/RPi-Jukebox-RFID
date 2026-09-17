import { useTranslation } from 'react-i18next';

import {
  Grid,
  List,
} from '@mui/material';

import SettingsSection from '../section';

import StatusBattery from './battery';
import StatusCpuTemp from './cpu-temp';
import StatusDiskUsage from './disk-usage';
import StatusIpAddress from './ip-address';
import StatusVersion from './version';

const SettingsStatus = () => {
  const { t } = useTranslation();

  return (
    <SettingsSection id="system-status" title={t('settings.status.title')}>
      <Grid container>
        <Grid size={12}>
          {/* the card content already carries the padding */}
          <List disablePadding>
            <StatusVersion />
            <StatusBattery />
            <StatusDiskUsage />
            <StatusIpAddress />
            <StatusCpuTemp />
          </List>
        </Grid>
      </Grid>
    </SettingsSection>
  );
}

export default SettingsStatus;
