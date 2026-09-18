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
      // One column, on every screen size: the sections have different heights,
      // so side by side they never line up and the page reads as unordered.
      display: 'flex',
      flexDirection: 'column',
      gap: 'var(--space-3)',
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
