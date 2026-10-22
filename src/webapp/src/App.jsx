import { Suspense } from 'react';

import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';

import AppSettingsProvider from './context/appsettings';
import HistorySwipeProvider from './context/history-swipe';
import NavigationVisibilityProvider from './context/navigation';
import SimpleModeProvider from './context/simple-mode';
import PubSubProvider from './context/pubsub';
import PlayerProvider from './context/player';
import Router from './router';

function App() {
  return (
    <PubSubProvider>
      <PlayerProvider>
        <AppSettingsProvider>
          <SimpleModeProvider>
            <HistorySwipeProvider>
              <NavigationVisibilityProvider>
                <Router />
              </NavigationVisibilityProvider>
            </HistorySwipeProvider>
          </SimpleModeProvider>
        </AppSettingsProvider>
      </PlayerProvider>
    </PubSubProvider>
  );
}

// here app catches the suspense from page in case translations are not yet loaded
export default function WrappedApp() {
  return (
    <Suspense fallback={
      <Box
        sx={{
          alignItems: 'center',
          display: 'flex',
          justifyContent: 'center',
          minHeight: '100vh',
        }}
      >
        <CircularProgress aria-label="Loading page" />
      </Box>
    }>
      <App />
    </Suspense>
  );
}
