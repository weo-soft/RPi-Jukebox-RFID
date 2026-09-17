import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Skeleton from '@mui/material/Skeleton';

import noCover from '../../assets/noCover.jpg';

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
        <Box
          alt={t('player.cover.unavailable')}
          component="img"
          src={noCover}
          sx={{
            height: '100%',
            objectFit: 'cover',
            opacity: dimmed ? 0.6 : 1,
            width: '100%',
          }}
        />
      }
    </Paper>
  );
};

export default Cover;
