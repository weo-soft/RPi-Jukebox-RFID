import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Card,
  CardContent,
  Grid,
  List,
  ListItem,
  ListItemText,
  TextField,
  Typography,
} from '@mui/material';

const matchesSearch = (search) => {
  const needle = search.trim().toLowerCase();
  if (!needle) return () => true;

  return ({ album = '', albumartist = '' }) => (
    `${albumartist} ${album}`.toLowerCase().includes(needle)
  );
};

/*
 * The numbered album list of a bulk registration. It is how the physical stack is brought
 * into the order of the session and how a session is entered at a chosen album.
 */
const BulkList = ({
  onBack,
  onStartHere,
  position,
  queue,
}) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState('');
  const entries = queue.filter(matchesSearch(search));

  return (
    <Card elevation={0}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid size={12}>
            <TextField
              fullWidth
              id="cards-bulk-search"
              label={t('cards.bulk.list.search')}
              onChange={(event) => setSearch(event.target.value)}
              value={search}
              variant="outlined"
            />
          </Grid>
          <Grid size={12}>
            {entries.length === 0
              ? <Typography>{t('cards.bulk.list.no-match')}</Typography>
              : <List sx={{ width: '100%' }}>
                  {entries.map((entry, index) => (
                    <ListItem
                      disablePadding
                      key={entry.key}
                      selected={index === position}
                      sx={{ gap: 'var(--space-2)' }}
                    >
                      <ListItemText
                        primary={t('cards.bulk.list.row', {
                          number: entry.position,
                          album: entry.album || t('library.albums.unknown-album'),
                        })}
                        secondary={entry.albumartist || null}
                      />
                      {entry.bound
                        ? <Typography color="textSecondary">
                            {t('cards.bulk.list.bound')}
                          </Typography>
                        : <Button
                            onClick={() => onStartHere(index)}
                            variant="outlined"
                          >
                            {t('cards.bulk.list.start-here')}
                          </Button>
                      }
                    </ListItem>
                  ))}
                </List>
            }
          </Grid>
          <Grid
            container
            size={12}
            sx={{ gap: 'var(--space-2)', justifyContent: 'flex-end' }}
          >
            <Button onClick={onBack} variant="outlined">
              {t('cards.bulk.back')}
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default BulkList;
