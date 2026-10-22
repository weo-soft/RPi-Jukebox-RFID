import { useTranslation } from 'react-i18next';

import {
  Grid,
  Switch,
  Typography,
} from '@mui/material';

import { useSimpleMode } from '../../../context/simple-mode';

const rowSx = {
  alignItems: 'center',
  justifyContent: 'space-between',
};

const SimpleMode = () => {
  const { t } = useTranslation();
  const { setSimpleMode, simpleMode } = useSimpleMode();

  return (
    <Grid container sx={rowSx}>
      <Grid size={{ md: 10, xs: 9 }}>
        <Typography>
          {t('settings.general.simple_mode.title')}
        </Typography>
        <Typography color="textSecondary" variant="contentBody">
          {t('settings.general.simple_mode.description')}
        </Typography>
      </Grid>
      <Grid size={{ md: 2, xs: 3 }} sx={{ textAlign: 'right' }}>
        <Switch
          checked={Boolean(simpleMode)}
          onChange={(event) => setSimpleMode(event.target.checked)}
          slotProps={{
            input: { 'aria-label': t('settings.general.simple_mode.title') },
          }}
        />
      </Grid>
    </Grid>
  );
};

export default SimpleMode;
