import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Grid,
  Switch,
  Typography,
} from '@mui/material';

import AppSettingsContext from '../../../context/appsettings/context';
import { useNavigationVisibility } from '../../../context/navigation';
import request from '../../../utils/request';

const rowSx = {
  alignItems: 'center',
  justifyContent: 'space-between',
};

const NavigationVisibility = () => {
  const { t } = useTranslation();

  const {
    setSettings,
    settings,
  } = useContext(AppSettingsContext);
  const {
    localVisible,
    setLocalVisibility,
  } = useNavigationVisibility();

  const globalVisible = Boolean(settings?.navigation_visible_global);

  const updateGlobal = async (visible) => {
    setSettings(current => ({ ...current, navigation_visible_global: visible }));
    await request('setAppSettings', { settings: { navigation_visible_global: visible }});
  };

  return (
    <Grid
      container
      sx={{
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      <Grid container sx={rowSx}>
        <Grid size={{ md: 10, xs: 9 }}>
          <Typography>
            {t('settings.general.navigation_local.title')}
          </Typography>
          <Typography color="textSecondary" variant="contentBody">
            {t('settings.general.navigation_local.description')}
          </Typography>
        </Grid>
        <Grid size={{ md: 2, xs: 3 }} sx={{ textAlign: 'right' }}>
          <Switch
            checked={Boolean(localVisible)}
            disabled={globalVisible}
            onChange={(event) => setLocalVisibility(event.target.checked)}
            slotProps={{
              input: { 'aria-label': t('settings.general.navigation_local.title') },
            }}
          />
        </Grid>
      </Grid>
      <Grid container sx={rowSx}>
        <Grid size={{ md: 10, xs: 9 }}>
          <Typography>
            {t('settings.general.navigation_global.title')}
          </Typography>
          <Typography color="textSecondary" variant="contentBody">
            {t('settings.general.navigation_global.description')}
          </Typography>
        </Grid>
        <Grid size={{ md: 2, xs: 3 }} sx={{ textAlign: 'right' }}>
          <Switch
            checked={globalVisible}
            onChange={(event) => updateGlobal(event.target.checked)}
            slotProps={{
              input: { 'aria-label': t('settings.general.navigation_global.title') },
            }}
          />
        </Grid>
      </Grid>
    </Grid>
  );
};

export default NavigationVisibility;
