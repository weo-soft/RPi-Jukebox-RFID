import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';
import MusicNoteIcon from '@mui/icons-material/MusicNote';

const coverBox = {
  aspectRatio: '1',
  borderRadius: 'var(--radius-md)',
  maxHeight: '100%',
  maxWidth: '100%',
  overflow: 'hidden',
  position: 'relative',
  // the zone width and the inner height both limit the square
  width: 'min(100%, calc(100dvh - var(--nav-height) - 2 * var(--gutter)))',
};

const Cover = ({ coverImage, dimmed = false, isLoading = false }) => {
  const { t } = useTranslation();

  return (
    <Paper elevation={3} sx={coverBox}>
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
