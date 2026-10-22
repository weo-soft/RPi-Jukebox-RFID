import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import MusicNoteIcon from '@mui/icons-material/MusicNote';

// Seven quick taps reveal the navigation again, the same gesture Android uses
// for its developer options.
const REVEAL_TAPS = 7;
const REVEAL_TAP_WINDOW_MS = 3000;

const coverBox = {
  aspectRatio: '1',
  borderRadius: 'var(--radius-md)',
  maxHeight: '100%',
  maxWidth: '100%',
  overflow: 'hidden',
  position: 'relative',
  // the zone width and the inner height both limit the square
  width: 'min(100%, calc(100dvh - var(--nav-space, var(--nav-height)) - 2 * var(--gutter)))',
};

const Cover = ({
  coverImage,
  dimmed = false,
  isLoading = false,
  onRevealNavigation,
}) => {
  const { t } = useTranslation();
  const taps = useRef(0);
  const resetTimer = useRef();

  useEffect(() => () => clearTimeout(resetTimer.current), []);

  const handleTap = () => {
    if (!onRevealNavigation) return;

    taps.current += 1;
    clearTimeout(resetTimer.current);

    if (taps.current >= REVEAL_TAPS) {
      taps.current = 0;
      onRevealNavigation();
      return;
    }

    resetTimer.current = setTimeout(() => {
      taps.current = 0;
    }, REVEAL_TAP_WINDOW_MS);
  };

  return (
    <Paper
      data-testid="player-cover"
      elevation={3}
      onClick={handleTap}
      sx={coverBox}
    >
      {isLoading &&
        <Skeleton
          data-testid="cover-skeleton"
          variant="rectangular"
          sx={{ height: '100%', width: '100%' }}
        />
      }
      {!isLoading && coverImage &&
        <Box
          alt={t('player.cover.title')}
          component="img"
          src={coverImage}
          sx={{ height: '100%', objectFit: 'cover', width: '100%' }}
        />
      }
      {!isLoading && !coverImage &&
        // A dark square with one quiet icon: a bright replacement image lights
        // up the whole panel in a dark room.
        <Box
          sx={{
            alignItems: 'center',
            display: 'flex',
            height: '100%',
            justifyContent: 'center',
            opacity: dimmed ? 0.6 : 1,
            width: '100%',
          }}
        >
          <MusicNoteIcon
            sx={{ color: 'text.secondary', fontSize: 'var(--icon-primary)' }}
            titleAccess={t('player.cover.unavailable')}
          />
        </Box>
      }
    </Paper>
  );
};

export default Cover;
