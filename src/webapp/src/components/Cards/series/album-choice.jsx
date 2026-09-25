import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControl,
  Grid,
  InputLabel,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  NativeSelect,
  TextField,
  Typography,
} from '@mui/material';

import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import AlbumListItem from '../../Library/lists/albums/album-list/album-list-item';
import { DEFAULT_GROUPING_ID, GROUPINGS, groupAlbums } from './groups';

/*
 * The choice of the albums a series runs over. The albums of the source are
 * listed in groups, because a stack is sorted along one axis and a library of
 * hundreds is not read album by album: the group carries what a whole artist
 * costs in one click, it opens for the albums that have to be picked one by
 * one, and the whole choice is taken or dropped in one click. A ticked album
 * takes part in the series and keeps its place in the numbered list, whether it
 * has a card already or not.
 */
const AlbumChoice = ({
  albums,
  onChange,
  onBack,
  selection,
}) => {
  const { t } = useTranslation();
  const allKeys = useMemo(() => albums.map(({ key }) => key), [albums]);
  // The ticks show the series as it stands: without a selection it runs over
  // every album of the source.
  const chosen = useMemo(
    () => (selection === null ? new Set(allKeys) : new Set(selection.albumKeys)),
    [allKeys, selection],
  );
  const [groupingId, setGroupingId] = useState(() => selection?.groupingId ?? DEFAULT_GROUPING_ID);
  const [opened, setOpened] = useState(() => new Set());
  const [search, setSearch] = useState('');

  const groups = useMemo(
    () => groupAlbums(albums, groupingId, album => chosen.has(album.key)),
    [albums, chosen, groupingId],
  );

  const needle = search.trim().toLowerCase();
  // A search is a look-up across the groups, so the groups it finds open
  // themselves and the groups it does not touch drop out.
  const visibleGroups = groups
    .map(group => ({
      ...group,
      visible: needle
        ? group.albums.filter(({ album = '', albumartist = '' }) => (
            `${albumartist} ${album}`.toLowerCase().includes(needle)
          ))
        : group.albums,
    }))
    .filter(({ visible }) => visible.length > 0);

  const openKeys = albums.filter(({ bound }) => !bound).map(({ key }) => key);
  const openChosen = albums.filter(({ bound, key }) => !bound && chosen.has(key)).length;
  const everyAlbum = chosen.size === allKeys.length;

  // The whole source needs no list: it is the series without a choice.
  const publish = (keys) => {
    const next = new Set(keys);

    onChange(next.size === allKeys.length
      ? null
      : { albumKeys: allKeys.filter(key => next.has(key)), groupingId });
  };

  const toggleAlbum = (key) => {
    const next = new Set(chosen);
    if (next.has(key)) next.delete(key);
    else next.add(key);

    publish(next);
  };

  // A group is taken as a whole or left out as a whole, whatever the search
  // lists of it.
  const toggleGroup = (group) => {
    const next = new Set(chosen);
    const whole = group.albums.every(({ key }) => next.has(key));
    group.albums.forEach(({ key }) => (whole ? next.delete(key) : next.add(key)));

    publish(next);
  };

  const toggleOpened = (id) => {
    setOpened((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);

      return next;
    });
  };

  const renderGroup = (group) => {
    const label = group.id || t('cards.series.choice.no-albumartist');
    const whole = group.albums.every(({ key }) => chosen.has(key));
    const some = group.albums.some(({ key }) => chosen.has(key));
    const isOpened = Boolean(needle) || opened.has(group.id);

    return (
      <List key={group.id} sx={{ width: '100%' }}>
        <ListItem disablePadding>
          <ListItemButton onClick={() => toggleOpened(group.id)} sx={{ minHeight: 'var(--touch-min)' }}>
            <ListItemIcon sx={{ minWidth: 44 }}>
              <Checkbox
                checked={whole}
                edge="start"
                indeterminate={some && !whole}
                onChange={() => toggleGroup(group)}
                onClick={event => event.stopPropagation()}
                slotProps={{
                  input: {
                    'aria-label': t('cards.series.choice.select-group', { group: label }),
                  },
                }}
              />
            </ListItemIcon>
            <ListItemText
              primary={label}
              secondary={t('cards.series.choice.group-count', {
                chosen: group.chosen,
                open: group.open,
                total: group.total,
              })}
            />
            {isOpened ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </ListItemButton>
        </ListItem>
        {isOpened && group.visible.map(entry => (
          <AlbumListItem
            album={entry.album}
            albumartist={entry.albumartist}
            content_uri={entry.content_uri}
            cover_url={entry.cover_url}
            isSelected={chosen.has(entry.key)}
            isSelectable
            key={entry.key}
            note={entry.bound ? t('cards.series.list.bound') : null}
            onToggle={() => toggleAlbum(entry.key)}
            provider={entry.provider}
          />
        ))}
      </List>
    );
  };

  return (
    <Card elevation={0}>
      <CardContent>
        <Grid container spacing={2}>
          <Grid size={12}>
            <Typography variant="displaySubtitle">{t('cards.series.choice.title')}</Typography>
          </Grid>
          <Grid size={{ md: 6, xs: 12 }}>
            <FormControl fullWidth>
              <InputLabel htmlFor="cards-series-grouping" shrink>
                {t('cards.series.choice.group-by')}
              </InputLabel>
              <NativeSelect
                inputProps={{ id: 'cards-series-grouping' }}
                onChange={(event) => setGroupingId(event.target.value)}
                sx={{ '& select': { height: 'var(--touch-min)' } }}
                value={groupingId}
              >
                {GROUPINGS.map(({ id, labelKey }) => (
                  <option key={id} value={id}>{t(labelKey)}</option>
                ))}
              </NativeSelect>
            </FormControl>
          </Grid>
          <Grid size={{ md: 6, xs: 12 }}>
            <TextField
              fullWidth
              id="cards-series-choice-search"
              label={t('cards.series.choice.search')}
              onChange={(event) => setSearch(event.target.value)}
              value={search}
              variant="outlined"
            />
          </Grid>
          <Grid
            container
            size={12}
            sx={{
              alignItems: 'center',
              gap: 'var(--space-2)',
              justifyContent: 'flex-end',
            }}
          >
            <Typography sx={{ flex: 1 }}>
              {t('cards.series.choice.chosen', { count: chosen.size, open: openChosen })}
            </Typography>
            <Button onClick={() => publish(openKeys)} variant="outlined">
              {t('cards.series.choice.open-only')}
            </Button>
          </Grid>
          <Grid container size={12} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={() => publish(everyAlbum ? [] : allKeys)} variant="outlined">
              {everyAlbum
                ? t('cards.series.choice.deselect-all')
                : t('cards.series.choice.select-all')
              }
            </Button>
          </Grid>
          <Grid size={12}>
            {visibleGroups.length === 0
              ? <Typography>{t('cards.series.choice.no-match')}</Typography>
              : visibleGroups.map(renderGroup)
            }
          </Grid>
          <Grid container size={12} sx={{ justifyContent: 'flex-end' }}>
            <Button onClick={onBack} variant="outlined">
              {t('cards.series.back')}
            </Button>
          </Grid>
        </Grid>
      </CardContent>
    </Card>
  );
};

export default AlbumChoice;
