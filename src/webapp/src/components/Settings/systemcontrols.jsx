import { useTranslation } from 'react-i18next';

import {
  Grid,
} from '@mui/material';

import SettingsSection from './section';
import RebootDialog from './dialogs/reboot';
import ShutDownDialog from './dialogs/shutdown';

const SystemControls = () => {
  const { t } = useTranslation();

  return (
    <SettingsSection
      id="system-controls"
      title={t('settings.systemcontrols.title')}
    >
      <Grid
        container
        sx={{
          alignItems: 'center',
          justifyContent: 'space-around',
        }}
      >
        <Grid>
          <RebootDialog />
        </Grid>
        <Grid>
          <ShutDownDialog />
        </Grid>
      </Grid>
    </SettingsSection>
  );
};

export default SystemControls;
