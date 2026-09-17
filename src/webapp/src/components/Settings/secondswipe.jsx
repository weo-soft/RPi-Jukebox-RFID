import { useTranslation } from 'react-i18next';

import {
  FormControlLabel,
  Grid,
  Radio,
  RadioGroup,
} from '@mui/material';

import SettingsSection from './section';

const SettingsSecondSwipe = () => {
  const { t } = useTranslation();

  return (
    <SettingsSection
      id="second-swipe"
      subheader={t('settings.feature-not-enabled')}
      title={t('settings.secondswipe.title')}
    >
      <Grid container sx={{ flexDirection: 'column' }}>
        <RadioGroup aria-label="gender" name="gender1">
          <FormControlLabel
            disabled={true}
            control={<Radio />}
            label={t('settings.secondswipe.restart')}
            value="restart"
          />
          <FormControlLabel
            disabled={true}
            control={<Radio />}
            label={t('settings.secondswipe.toggle')}
            value="pause"
          />
          <FormControlLabel
            disabled={true}
            control={<Radio />}
            label={t('settings.secondswipe.skip')}
            value="skipnext"
          />
          <FormControlLabel
            disabled={true}
            control={<Radio />}
            label={t('settings.secondswipe.ignore')}
            value="noaudioplay"
          />
        </RadioGroup>
      </Grid>
    </SettingsSection>
  );
};

export default SettingsSecondSwipe;
