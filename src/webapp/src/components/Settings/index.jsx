import Box from '@mui/material/Box';

import SettingsAudio from './audio/index';
import SettingsAutoHotspot from './autohotspot';
import SettingsGeneral from './general';
import SettingsSecondSwipe from './secondswipe';
import SettingsStatus from './status/index';
import SettingsTimers from './timers/index';
import SystemControls from './systemcontrols';

const Settings = () => (
  <Box
    id="settings"
    sx={{
      alignItems: 'start',
      display: 'grid',
      gap: 'var(--space-4)',
      // two column card grid as soon as the landscape tier has room for it
      gridTemplateColumns: {
        md: 'repeat(2, minmax(0, 1fr))',
        xs: 'minmax(0, 1fr)',
      },
      minWidth: 0,
      width: '100%',
    }}
  >
    <SettingsStatus />
    <SettingsGeneral />
    <SettingsTimers />
    <SettingsAudio />
    <SystemControls />
    <SettingsSecondSwipe />
    <SettingsAutoHotspot />
  </Box>
);

export default Settings;
