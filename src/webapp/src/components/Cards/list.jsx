import { forwardRef, memo, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import {
  Avatar,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  ListSubheader,
  Typography,
} from '@mui/material';

import BookmarkIcon from '@mui/icons-material/Bookmark';

import { describeCard, describeText } from './describe';

// Long lists are not windowed up front: search and grouping carry them. Once
// the measurements ask for windowing, it starts above this many entries.
const LIST_WINDOW_THRESHOLD = 500;

const UNASSIGNABLE = 'unassignable';

const groupLabel = (group, t) => (
  group === UNASSIGNABLE
    ? t('cards.list.unassignable')
    : t(`library.sources.${group}`, { defaultValue: group })
);

const commandLabel = (command, t) => (
  t(`cards.controls.command-selector.commands.${command}`, { defaultValue: command })
);

/*
 * The card list as a checking tool: the content of a card is its leading text
 * and the chip number follows it, so a card is found by what it holds instead
 * of by the number printed on it.
 */
const CardsList = ({
  cardsList,
  isGrouped = true,
  search = '',
}) => {
  const { t } = useTranslation();

  const entries = useMemo(() => Object.entries(cardsList || {}).map(([cardId, card]) => {
    const description = describeCard(card);
    const content = describeText(card);
    const command = description.type === 'other' ? description.command : card.from_alias;

    return {
      card,
      cardId,
      content: content || (command ? commandLabel(command, t) : t('cards.list.unknown-content')),
      group: description.type === 'album' ? (description.provider || 'mpd') : UNASSIGNABLE,
      searchText: [content, command, description.albumartist, cardId]
        .filter(Boolean)
        .join(' ')
        .toLowerCase(),
    };
  }), [cardsList, t]);

  if (!cardsList || Object.keys(cardsList).length === 0) {
    return <Typography>{t('cards.list.no-cards-registered')}</Typography>;
  }

  const needle = search.trim().toLowerCase();
  const visible = needle
    ? entries.filter(({ searchText }) => searchText.includes(needle))
    : entries;

  if (visible.length === 0) {
    return <Typography>{t('cards.list.no-match')}</Typography>;
  }

  const groups = isGrouped
    ? [...new Set(visible.map(({ group }) => group))].map(group => ({
        entries: visible.filter(entry => entry.group === group),
        group,
      }))
    : [{ entries: visible, group: null }];

  const renderCard = ({ card, cardId, content }) => {
    const EditCardLink = forwardRef((props, ref) => (
      <Link
        ref={ref}
        state={{ id: cardId, ...card }}
        to={`/cards/${cardId}/edit`}
        {...props}
      />
    ));
    EditCardLink.displayName = 'EditCardLink';

    return (
      <ListItem disablePadding key={cardId}>
        <ListItemButton
          component={EditCardLink}
          nativeButton={false}
          sx={{ minHeight: 96 }}
        >
          <ListItemAvatar sx={{ minWidth: 56 }}>
            <Avatar>
              <BookmarkIcon />
            </Avatar>
          </ListItemAvatar>
          <ListItemText
            primary={content}
            secondary={cardId}
            slotProps={{
              primary: {
                sx: {
                  display: '-webkit-box',
                  overflow: 'hidden',
                  overflowWrap: 'anywhere',
                  WebkitBoxOrient: 'vertical',
                  WebkitLineClamp: 2,
                },
                title: content,
              },
              secondary: {
                sx: {
                  fontFamily: 'monospace',
                  fontSize: 18,
                },
              },
            }}
          />
        </ListItemButton>
      </ListItem>
    );
  };

  return (
    <>
      {groups.map(({ entries: groupEntries, group }) => (
        <List
          key={group || 'all'}
          subheader={group ? <ListSubheader>{groupLabel(group, t)}</ListSubheader> : undefined}
          sx={{ width: '100%' }}
        >
          {groupEntries.map(renderCard)}
        </List>
      ))}
    </>
  );
}

export {
  CardsList,
  LIST_WINDOW_THRESHOLD,
};

export default memo(CardsList);
