import { useTranslation } from 'react-i18next';

import {
  Divider,
} from '@mui/material';

import SettingsSection from '../section';
import MaxVolume from './max-volume';
import Outputs from './outputs';

const SettingsAudio = () => {
  const { t } = useTranslation();

  return (
    <SettingsSection id="audio" title={t('settings.audio.title')}>
      <Outputs />
      <Divider sx={{ marginY: 'var(--space-3)' }} />
      <MaxVolume />
    </SettingsSection>
  );
};

export default SettingsAudio;
