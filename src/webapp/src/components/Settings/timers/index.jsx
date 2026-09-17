import { useTranslation } from 'react-i18next';

import {
  Grid,
  List,
} from '@mui/material';

import SettingsSection from '../section';
import Timer from './timer';

const SettingsTimers = () => {
  const { t } = useTranslation();

  return (
    <SettingsSection id="timers" title={t('settings.timers.title')}>
      <Grid size={12}>
        <List>
          <Timer type={'fade-volume'} />
          <Timer type={'shutdown'} />
          <Timer type={'stop-player'} />
          <Timer type={'idle-shutdown'} />
        </List>
      </Grid>
    </SettingsSection>
  );
};

export default SettingsTimers;
