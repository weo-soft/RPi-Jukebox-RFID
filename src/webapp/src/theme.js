import { teal } from '@mui/material/colors';
import { createTheme } from '@mui/material/styles';

/*
 * The theme reads the design tokens from index.css through var(...). It defines
 * no sizes of its own, so sx styles and global rules share one source.
 */
const theme = createTheme({
  cssVariables: true,
  palette: {
    mode: 'dark',
    primary: {
      ...teal,
      // teal[500] against white is 3.68:1; the dark label reaches 5.10:1
      contrastText: '#121212',
    },
  },
  typography: {
    displayTitle: {
      fontSize: 'var(--font-display)',
      fontWeight: 600,
      lineHeight: 1.15,
    },
    displaySubtitle: {
      fontSize: 'var(--font-display-sub)',
      lineHeight: 1.3,
    },
    timeLabel: {
      fontSize: 'var(--font-time)',
      fontVariantNumeric: 'tabular-nums',
    },
    sectionTitle: {
      fontSize: 'var(--font-section)',
      fontWeight: 500,
    },
    contentBody: {
      fontSize: 'var(--font-body)',
    },
  },
  components: {
    MuiBottomNavigationAction: {
      styleOverrides: {
        root: {
          // MUI caps the action at 168 px, which leaves dead space in a wide bar
          maxWidth: 'none',
          minWidth: 0,
          minHeight: 'var(--touch-min)',
          paddingBottom: 8,
          paddingTop: 8,
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          minHeight: 'var(--touch-comfort)',
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 'var(--radius-pill)',
          minHeight: 'var(--touch-min)',
          minWidth: 'var(--touch-min)',
        },
      },
    },
    MuiInputBase: {
      styleOverrides: {
        root: {
          minHeight: 'var(--touch-min)',
        },
      },
    },
    MuiCheckbox: {
      styleOverrides: {
        root: {
          padding: 'calc((var(--touch-min) - 20px) / 2)',
        },
      },
    },
    MuiFormControlLabel: {
      styleOverrides: {
        root: {
          minHeight: 72,
        },
      },
    },
    MuiRadio: {
      styleOverrides: {
        root: {
          padding: 'calc((var(--touch-min) - 20px) / 2)',
        },
      },
    },
    MuiMenuItem: {
      styleOverrides: {
        root: {
          minHeight: 56,
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          minHeight: 72,
        },
      },
    },
    MuiSlider: {
      styleOverrides: {
        // MUI renders the slider with content-box and a 13 px vertical padding;
        // without the reset a 48 px token would produce a 74 px row.
        root: {
          height: 'var(--touch-min)',
          padding: 0,
          // On a coarse pointer MUI adds a 20 px padding of its own, which would
          // grow the row to 88 px. The row height is the token, not the padding.
          '@media (pointer: coarse)': {
            padding: 0,
          },
        },
        rail: {
          borderRadius: 'var(--radius-pill)',
          height: 8,
        },
        thumb: {
          height: 24,
          width: 24,
        },
        track: {
          border: 'none',
          borderRadius: 'var(--radius-pill)',
          height: 8,
        },
      },
    },
    MuiToggleButton: {
      styleOverrides: {
        root: {
          minHeight: 'var(--touch-min)',
        },
      },
    },
    MuiSwitch: {
      styleOverrides: {
        root: {
          minHeight: 'var(--touch-min)',
          minWidth: 'var(--touch-min)',
        },
        switchBase: {
          padding: 'calc((var(--touch-min) - 20px) / 2)',
        },
      },
    },
  },
});

export default theme;
