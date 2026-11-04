import { useContext } from 'react';
import { useTranslation } from 'react-i18next';

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import EmptyState from './empty-state';

import PlayerContext from '../../context/player/context';

const Display = () => {
  const { t } = useTranslation();
  const { state: { playerstatus } } = useContext(PlayerContext);

  if (!playerstatus?.songid) {
    return <EmptyState />;
  }

  const title = playerstatus.title || t('player.display.unknown-title');
  const subtitle = [
    playerstatus.artist || t('player.display.unknown-artist'),
    playerstatus.album || playerstatus.file,
  ].filter(Boolean).join(' \u2022 ');

  return (
    <Box sx={{ minWidth: 0 }}>
      <Typography
        component="h5"
        sx={{
          display: '-webkit-box',
          overflow: 'hidden',
          overflowWrap: 'anywhere',
          WebkitBoxOrient: 'vertical',
          WebkitLineClamp: 2,
        }}
        variant="displayTitle"
      >
        {title}
      </Typography>
      <Typography
        color="textSecondary"
        // A custom variant has no default mapping, and an inline element neither
        // clips nor honours text-overflow; long titles need the block box.
        component="p"
        sx={{
          margin: 0,
          marginTop: 'var(--space-2)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={subtitle}
        variant="displaySubtitle"
      >
        {subtitle}
      </Typography>
    </Box>
  );
};

export default Display;
