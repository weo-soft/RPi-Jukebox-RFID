import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Button,
  Card,
  CardContent,
  Checkbox,
  Fab,
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

import CheckIcon from '@mui/icons-material/Check';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

import AlbumListItem from '../../Library/lists/albums/album-list/album-list-item';
import { DEFAULT_GROUPING_ID, GROUPINGS, groupAlbums } from './groups';

/*
 * The choice of the albums a bulk registration runs over. The albums of the source are
 * listed in groups, because a stack is sorted along one axis and a library of
 * hundreds is not read album by album: the group carries what a whole artist
 * costs in one click, it opens for the albums that have to be picked one by
 * one, and the whole choice is taken or dropped in one click. A ticked album
 * takes part in the registration and keeps its place in the numbered list, whether it
 * has a card already or not. The way out is a floating control that confirms the
 * choice, so a library of many groups never hides it behind a long scroll.
 */
const AlbumChoice = ({
  albums,
  onChange,
  onBack,
  selection,
}) => {
  const { t } = useTranslation();
  const allKeys = useMemo(() => albums.map(({ key }) => key), [albums]);
  // The ticks show the registration as it stands: without a selection it runs over
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

  // The whole source needs no list: it is the registration without a choice.
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
    const label = group.id || t('cards.bulk.choice.no-albumartist');
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
                    'aria-label': t('cards.bulk.choice.select-group', { group: label }),
                  },
                }}
              />
            </ListItemIcon>
            <ListItemText
              primary={label}
              secondary={t('cards.bulk.choice.group-count', {
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
            key={entry.key}
            note={entry.bound ? t('cards.bulk.list.bound') : null}
            onToggle={() => toggleAlbum(entry.key)}
            provider={entry.provider}
          />
        ))}
      </List>
    );
  };

  return (
    <>
      <Card
        elevation={0}
        // The list ends above the floating control instead of under it.
        sx={{ marginBottom: 'calc(var(--touch-secondary) + var(--space-4))' }}
      >
        <CardContent>
          <Grid container spacing={2}>
            <Grid size={12}>
              <Typography variant="displaySubtitle">{t('cards.bulk.choice.title')}</Typography>
            </Grid>
            <Grid size={{ md: 6, xs: 12 }}>
              <FormControl fullWidth>
                <InputLabel htmlFor="cards-bulk-grouping" shrink>
                  {t('cards.bulk.choice.group-by')}
                </InputLabel>
                <NativeSelect
                  inputProps={{ id: 'cards-bulk-grouping' }}
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
                id="cards-bulk-choice-search"
                label={t('cards.bulk.choice.search')}
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
                {t('cards.bulk.choice.chosen', { count: chosen.size, open: openChosen })}
              </Typography>
              <Button onClick={() => publish(openKeys)} variant="outlined">
                {t('cards.bulk.choice.open-only')}
              </Button>
            </Grid>
            <Grid container size={12} sx={{ justifyContent: 'flex-start' }}>
              <Button onClick={() => publish(everyAlbum ? [] : allKeys)} variant="outlined">
                {everyAlbum
                  ? t('cards.bulk.choice.deselect-all')
                  : t('cards.bulk.choice.select-all')
                }
              </Button>
            </Grid>
            <Grid size={12}>
              {visibleGroups.length === 0
                ? <Typography>{t('cards.bulk.choice.no-match')}</Typography>
                : visibleGroups.map(renderGroup)
              }
            </Grid>
          </Grid>
        </CardContent>
      </Card>
      {/* The way out applies what is ticked and leads to the start area: it
          confirms the choice instead of leaving it behind. It floats, because a
          library of many groups must not hide it behind a long scroll. */}
      <Fab
        color="primary"
        onClick={onBack}
        sx={{
          bottom: 'calc(var(--nav-height) + var(--space-4))',
          minHeight: 'var(--touch-secondary)',
          position: 'fixed',
          right: 'var(--gutter)',
        }}
        variant="extended"
      >
        <CheckIcon sx={{ marginRight: 'var(--space-2)' }} />
        {t('cards.bulk.choice.confirm')}
      </Fab>
    </>
  );
};

export default AlbumChoice;
