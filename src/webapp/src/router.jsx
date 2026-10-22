import { lazy } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router-dom';

import Navigation from './components/Navigation';
import { useNavigationVisibility } from './context/navigation';

import Grid from '@mui/material/Grid';

const Cards = lazy(() => import('./components/Cards'));
const Library = lazy(() => import('./components/Library'));
const Player = lazy(() => import('./components/Player'));
const Settings = lazy(() => import('./components/Settings'));

const AppLayout = () => {
  const { pathname } = useLocation();
  const { showStartNavigation } = useNavigationVisibility();
  const hideStartNavigation = pathname === '/' && !showStartNavigation;

  return (
    <Grid
      container
      id="routes"
      style={{ '--nav-space': hideStartNavigation ? '0px' : 'var(--nav-height)' }}
      sx={{
        // Views start at the top. Centring them vertically moved a view
        // that was still loading into the middle of the screen and let it
        // jump up as soon as its content arrived.
        alignItems: 'flex-start',
        justifyContent: 'center',
        // The readability limit sits on the shell, not on the content column
        maxWidth: 'min(100%, 1100px)',
        marginX: 'auto',
        minHeight: '100dvh',
        padding: 'var(--gutter)',
        paddingBottom: hideStartNavigation
          ? 'var(--gutter)'
          : 'calc(var(--nav-height) + var(--gutter))',
      }}
    >
      <Grid
        component="main"
        size="grow"
      >
        <Routes>
          <Route
            index
            element={<Player/>}
          />
          <Route
            path="library/*"
            element={<Library/>}
          />
          <Route
            path="cards/*"
            element={<Cards/>}
          />
          <Route
            path="settings/*"
            element={<Settings/>}
          />
        </Routes>
      </Grid>
      {!hideStartNavigation && <Navigation />}
    </Grid>
  );
};

const Router = () => {
  return (
    <HashRouter>
      <AppLayout />
    </HashRouter>
  );
}

export default Router;
