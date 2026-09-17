import {
  Link,
  matchPath,
  useLocation,
} from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import BottomNavigation from '@mui/material/BottomNavigation';
import BottomNavigationAction from '@mui/material/BottomNavigationAction';
import BookmarksIcon from '@mui/icons-material/Bookmarks';
import HomeIcon from '@mui/icons-material/Home';
import MusicNoteIcon from '@mui/icons-material/MusicNote';
import SettingsIcon from '@mui/icons-material/Settings';

const navigationItems = [
  {
    icon: HomeIcon,
    labelKey: 'navigation.start',
    matchPattern: { path: '/', end: true },
    to: '/',
  },
  {
    icon: MusicNoteIcon,
    labelKey: 'navigation.library',
    matchPattern: { path: '/library/*' },
    to: '/library',
  },
  {
    icon: BookmarksIcon,
    labelKey: 'navigation.cards',
    matchPattern: { path: '/cards/*' },
    to: '/cards',
  },
  {
    icon: SettingsIcon,
    labelKey: 'navigation.settings',
    matchPattern: { path: '/settings/*' },
    to: '/settings',
  },
];

export default function Navigation() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const value = navigationItems.find(({ matchPattern }) => (
    matchPath(matchPattern, pathname)
  ))?.to ?? false;

  return (
    <BottomNavigation
      component="nav"
      value={value}
      showLabels
      sx={{
        borderTop: '1px solid rgba(255, 255, 255, .12)',
        bottom: 0,
        height: 'var(--nav-height)',
        left: 0,
        // the bar is fixed, so it carries the shell limit and centering itself
        marginX: 'auto',
        maxWidth: 'min(100%, 1100px)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        position: 'fixed',
        right: 0,
      }}
    >
      {navigationItems.map(({
        icon: Icon,
        labelKey,
        to,
      }) => {
        const isActive = value === to;

        return (
          <BottomNavigationAction
            aria-current={isActive ? 'page' : undefined}
            component={Link}
            icon={
              <Box
                component="span"
                sx={{
                  alignItems: 'center',
                  backgroundColor: isActive
                    ? 'rgba(0, 150, 136, .18)'
                    : 'transparent',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  height: 32,
                  justifyContent: 'center',
                  width: 48,
                }}
              >
                <Icon sx={{ fontSize: 'var(--icon-comfort)' }} />
              </Box>
            }
            key={to}
            label={t(labelKey)}
            nativeButton={false}
            sx={{
              '& .MuiBottomNavigationAction-label': {
                fontSize: 'var(--font-nav)',
              },
              // the active tab is marked by color and by a filled surface
              '&.Mui-selected': {
                color: 'primary.light',
              },
            }}
            to={to}
            value={to}
          />
        );
      })}
    </BottomNavigation>
  );
}
