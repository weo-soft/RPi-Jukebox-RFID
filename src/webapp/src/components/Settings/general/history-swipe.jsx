import { useTranslation } from 'react-i18next';

import {
  Grid,
  Switch,
  Typography,
} from '@mui/material';

import { useHistorySwipe } from '../../../context/history-swipe';

const rowSx = {
  alignItems: 'center',
  justifyContent: 'space-between',
};

const HistorySwipe = () => {
  const { t } = useTranslation();
  const {
    preventHistorySwipe,
    setPreventHistorySwipe,
  } = useHistorySwipe();

  return (
    <Grid container sx={rowSx}>
      <Grid size={{ md: 10, xs: 9 }}>
        <Typography>
          {t('settings.general.history_swipe.title')}
        </Typography>
        <Typography color="textSecondary" variant="contentBody">
          {t('settings.general.history_swipe.description')}
        </Typography>
      </Grid>
      <Grid size={{ md: 2, xs: 3 }} sx={{ textAlign: 'right' }}>
        <Switch
          checked={Boolean(preventHistorySwipe)}
          onChange={(event) => setPreventHistorySwipe(event.target.checked)}
          slotProps={{
            input: { 'aria-label': t('settings.general.history_swipe.title') },
          }}
        />
      </Grid>
    </Grid>
  );
};

export default HistorySwipe;
