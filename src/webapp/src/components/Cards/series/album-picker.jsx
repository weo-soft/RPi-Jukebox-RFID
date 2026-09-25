import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Grid,
  List,
  Switch,
  TextField,
  Typography,
} from '@mui/material';

import AlbumListItem from '../../Library/lists/albums/album-list/album-list-item';
import CardIdField from '../card-id-field';
import { filterAlbums } from './picker-filter';

/*
 * The album picker of the free mode: a card is at hand - placed or typed - and
 * the album it belongs to is chosen from the list of the source. The choice
 * binds immediately, there is no save in between.
 */
const AlbumPicker = ({
  albums,
  cardId,
  onBack,
  onBind,
  onCardId,
}) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const [onlyOpen, setOnlyOpen] = useState(true);
  const visible = filterAlbums(albums, { onlyOpen, search });

  return (
    <Card elevation={0}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid size={12}>
            <Typography variant="displaySubtitle">
              {cardId
                ? t('cards.series.picker-with-card', { cardId })
                : t('cards.series.picker-no-card')
              }
            </Typography>
          </Grid>
          {!cardId &&
            <Grid size={12}>
              <CardIdField
                actionLabel={t('cards.series.picker-continue')}
                onActivate={onCardId}
              />
            </Grid>
          }
          {cardId && <Grid size={12}>
            <TextField
              fullWidth
              id="cards-series-picker-search"
              label={t('cards.series.list.search')}
              onChange={(event) => setSearch(event.target.value)}
              value={search}
              variant="outlined"
            />
          </Grid>}
          {cardId && <Grid size={12}>
            <FormControlLabel
              control={
                <Switch
                  checked={onlyOpen}
                  onChange={(event) => setOnlyOpen(event.target.checked)}
                />
              }
              label={t('cards.series.picker-only-open')}
            />
          </Grid>}
          {cardId && <Grid size={12}>
            {visible.length === 0
              ? <Typography>{t('cards.series.picker-no-match')}</Typography>
              : <List sx={{ width: '100%' }}>
                  {visible.map((album) => (
                    <AlbumListItem
                      album={album.album}
                      albumartist={album.albumartist}
                      content_uri={album.content_uri}
                      cover_url={album.cover_url}
                      key={album.key}
                      onSelect={() => onBind(album)}
                      provider={album.provider}
                    />
                  ))}
                </List>
            }
          </Grid>}
          <Grid
            container
            size={12}
            sx={{ justifyContent: 'flex-end' }}
          >
            <Button onClick={onBack} variant="outlined">
              {t('cards.series.back')}
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default AlbumPicker;
