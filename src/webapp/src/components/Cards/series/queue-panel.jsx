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
import CardIdField from '../card-id-field';

/*
 * The running series: the album whose card is put on the reader next, the
 * position in the numbered list and the number of albums still open.
 */
const QueuePanel = ({
  album,
  onBack,
  onBind,
  onOpenList,
  openAlbums,
  position,
  total,
}) => {
  const { t } = useTranslation();

  return (
    <Card elevation={0}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid size={{ md: 6, xs: 12 }}>
            <Typography variant="contentBody">
              {t('cards.series.position', { number: position, total })}
            </Typography>
          </Grid>
          <Grid size={{ md: 6, xs: 12 }}>
            <Typography color="textSecondary" variant="contentBody">
              {t('cards.series.open-count', { count: openAlbums })}
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
            <Typography variant="displaySubtitle">
              {t('cards.series.place-card')}
            </Typography>
          </Grid>
          <Grid size={12}>
            <CardIdField
              actionLabel={t('cards.series.bind')}
              onActivate={onBind}
            />
          </Grid>
          <Grid
            container
            size={12}
            sx={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}
          >
            <Button onClick={onOpenList} variant="outlined">
              {t('cards.series.open-list')}
            </Button>
            <Button onClick={onBack} variant="outlined">
              {t('cards.series.back')}
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default QueuePanel;
