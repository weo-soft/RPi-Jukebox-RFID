import { useTranslation } from 'react-i18next';

import {
  Button,
  Card,
  CardContent,
  Grid,
  List,
  Typography,
} from '@mui/material';

import AlbumListItem from '../../Library/lists/albums/album-list/album-list-item';

/*
 * The feedback right after a binding: which album went to which card, and the
 * undo next to it. It stays until the next binding replaces it.
 */
const BoundFeedback = ({
  album,
  cardId,
  number,
  onUndo,
}) => {
  const { t } = useTranslation();

  return (
    <Card elevation={0}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid size={12}>
            <Typography>
              {t('cards.series.bound-at', { number })}
            </Typography>
          </Grid>
          <Grid size={12}>
            <List>
              <AlbumListItem
                album={album.album}
                albumartist={album.albumartist}
                content_uri={album.content_uri}
                cover_url={album.cover_url}
                isButton={false}
                provider={album.provider}
              />
            </List>
          </Grid>
          <Grid size={12}>
            <Typography sx={{ fontFamily: 'monospace' }}>
              {cardId}
            </Typography>
          </Grid>
          <Grid
            container
            size={12}
            sx={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}
          >
            <Button onClick={onUndo} variant="outlined">
              {t('cards.series.undo')}
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default BoundFeedback;
