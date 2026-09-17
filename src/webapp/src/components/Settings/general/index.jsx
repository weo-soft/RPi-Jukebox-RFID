import { useTranslation } from 'react-i18next';

import { useTheme } from '@mui/material/styles';

import {
  Grid,
} from '@mui/material';

import SettingsSection from '../section';
import ShowCovers from './show-covers';

const SettingsGeneral = () => {
  const { t } = useTranslation();
  const theme = useTheme();
  const spacer = { marginBottom: theme.spacing(2) }

  return (
    <SettingsSection id="general" title={t('settings.general.title')}>
      <Grid
        container
        sx={{
          '& > .MuiGrid-root:not(:last-child)': spacer,
          flexDirection: 'column',
        }}
      >
        <ShowCovers />
      </Grid>
    </SettingsSection>
  );
};

export default SettingsGeneral;
