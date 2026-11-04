import Box from '@mui/material/Box';

import SettingsAudio from './audio/index';
import SettingsDisplay from './display/index';
import SettingsAutoHotspot from './autohotspot';
import SettingsGeneral from './general';
import SettingsJellyfin from './jellyfin';
import SettingsMcp23017 from './mcp23017';
import SettingsSecondSwipe from './secondswipe';
import SettingsSpotify from './spotify';
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
    <SettingsMcp23017 />
    <SettingsTimers />
    <SettingsDisplay />
    <SettingsAudio />
    <SettingsSpotify />
    <SettingsJellyfin />
    <SystemControls />
    <SettingsSecondSwipe />
    <SettingsAutoHotspot />
  </Box>
);

export default Settings;
