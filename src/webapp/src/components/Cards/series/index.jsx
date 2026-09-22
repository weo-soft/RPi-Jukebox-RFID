import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';

import {
  Button,
  Card,
  CardContent,
  Grid,
  Typography,
} from '@mui/material';

import Header from '../../Header';
import { Loading } from '../../general';
import request from '../../../utils/request';
import { initSockets } from '../../../sockets';
import { flatByAlbum } from '../../../utils/utils';
import { buildActionData, getActionAndCommand, getArgsValues } from '../utils';
import { loadRegisteredCards, registeredEntry } from '../registered-cards';
import { isAlbumCard } from './keys';
import { orderById } from './orders';
import {
  buildQueue,
  indexOfAlbum,
  nextOpenIndex,
  openCount,
} from './queue';
import {
  memoryPosition,
  readSeriesMemory,
  writeSeriesMemory,
} from './series-memory';
import { createPlacementCounter } from './events';
import {
  EMPTY_SESSION,
  forgetBinding,
  lastBinding,
  rememberBinding,
  withCard,
  withoutCard,
} from './session';
import BoundFeedback from './bound-feedback';
import ConflictPanel from './conflict-panel';
import QueuePanel from './queue-panel';
import SeriesList from './series-list';
import StartPanel from './start-panel';

const VIEW_START = 'start';
const VIEW_QUEUE = 'queue';
const VIEW_LIST = 'list';

const albumActionData = (album) => buildActionData('play_music', 'play_album', {
  albumartist: album.albumartist,
  album: album.album,
  content_uri: album.content_uri,
  provider: album.provider,
});

/*
 * A card series: the album list of one source in one order. The screen leads
 * from its start area into the queue or into the numbered list that brings the
 * physical stack into the same order. What counts as open follows from the
 * inventory - an album is open while no card names it - so no progress of its
 * own has to be kept.
 */
const CardsSeries = () => {
  const { t } = useTranslation();

  const [memory] = useState(() => readSeriesMemory());
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState(VIEW_START);
  const [sources, setSources] = useState([]);
  const [provider, setProvider] = useState(null);
  const [orderId, setOrderId] = useState(() => orderById(memory?.order).id);
  const [albums, setAlbums] = useState([]);
  const [cards, setCards] = useState(null);
  const [isLoadingSources, setIsLoadingSources] = useState(true);
  const [isLoadingCards, setIsLoadingCards] = useState(true);
  const [isLoadingAlbums, setIsLoadingAlbums] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [startIndex, setStartIndex] = useState(-1);
  const [position, setPosition] = useState(0);
  const [events, setEvents] = useState({});
  const [placement, setPlacement] = useState(null);
  const [session, setSession] = useState(EMPTY_SESSION);
  const [bound, setBound] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [failure, setFailure] = useState(null);

  const isFirstEvent = useRef(true);
  const isNewPlacement = useRef(createPlacementCounter());
  const placements = useRef(0);
  const handledPlacement = useRef(0);

  useEffect(() => {
    let isCurrent = true;

    const loadSources = async () => {
      setIsLoadingSources(true);
      const { result, error } = await request('librarySources');
      if (!isCurrent) return;

      setIsLoadingSources(false);
      if (error) {
        setLoadError(error);
        return;
      }

      setSources(result || []);
    };

    loadSources();
    return () => { isCurrent = false; };
  }, [attempt]);

  useEffect(() => {
    let isCurrent = true;

    const loadCards = async () => {
      setIsLoadingCards(true);
      const { cards: registered, error } = await loadRegisteredCards();
      if (!isCurrent) return;

      setIsLoadingCards(false);
      if (error) {
        setLoadError(error);
        return;
      }

      setCards(registered);
    };

    loadCards();
    return () => { isCurrent = false; };
  }, [attempt]);

  useEffect(() => {
    if (provider === null) return undefined;
    let isCurrent = true;

    const loadAlbums = async () => {
      setIsLoadingAlbums(true);
      const { result, error } = await request('libraryItems', {
        provider,
        content_types: ['album'],
      });
      if (!isCurrent) return;

      setIsLoadingAlbums(false);
      if (error) {
        setLoadError(error);
        return;
      }

      setAlbums((result || []).reduce(flatByAlbum, []));
    };

    loadAlbums();
    return () => { isCurrent = false; };
  }, [attempt, provider]);

  // The source of a remembered session is taken up again; otherwise the first
  // source the core reports is the default.
  useEffect(() => {
    if (provider !== null || isLoadingSources) return;
    if (sources.length === 0) {
      setIsLoadingAlbums(false);
      return;
    }

    const remembered = memory?.source;
    const known = sources.some(({ id }) => id === remembered);
    setProvider(known ? remembered : sources[0].id);
  }, [isLoadingSources, memory, provider, sources]);

  // The event stream carries the card placements. The broker repeats the last
  // value on every subscription, so the value that is already there when the
  // screen opens is no placement.
  useEffect(() => initSockets({ events: ['rfid.card_id'], setState: setEvents }), []);

  useEffect(() => {
    const cardId = events['rfid.card_id'];
    if (cardId === undefined) return;

    if (isFirstEvent.current) {
      isFirstEvent.current = false;
      return;
    }

    if (!isNewPlacement.current({ cardId, at: Date.now() })) return;

    placements.current += 1;
    setPlacement({ cardId, serial: placements.current });
  }, [events]);

  const order = orderById(orderId);
  const queue = useMemo(
    () => buildQueue({ albums, cards: cards ?? {}, compare: order.compare }),
    [albums, cards, order],
  );

  const openAlbums = openCount(queue);
  const firstOpen = nextOpenIndex(queue, 0);
  // The session starts at the first open album of the order; a remembered
  // start point is offered, not applied.
  const rememberedIndex = memoryPosition(queue, memory);
  const continuing = rememberedIndex >= 0 ? nextOpenIndex(queue, rememberedIndex + 1) : -1;
  const startPosition = startIndex >= 0 ? startIndex : firstOpen;
  const startNumber = startPosition >= 0 && queue[startPosition] ? queue[startPosition].position : 0;
  const canStart = openAlbums > 0;

  const bind = useCallback(async (cardId) => {
    const album = queue[position];
    // Without the card list the conflict test would run into nothing.
    if (cards === null || !album || album.bound) return;

    setFailure(null);

    const existing = registeredEntry(cards, cardId);
    if (existing) {
      setConflict({ album, cardId, existing });
      return;
    }

    setConflict(null);

    const actionData = albumActionData(album);
    const { command: cmdAlias } = getActionAndCommand(actionData);
    const args = getArgsValues(actionData);

    const { error } = await request('registerCard', {
      card_id: cardId,
      cmd_alias: cmdAlias,
      args,
      overwrite: false,
    });

    if (error) {
      // A card that appeared in the database in the meantime is a conflict and
      // not a failure of the series.
      const { cards: reRead } = await loadRegisteredCards();
      const meanwhile = registeredEntry(reRead || {}, cardId);

      if (meanwhile) {
        setCards(reRead);
        setConflict({ album, cardId, existing: meanwhile });
        return;
      }

      setFailure({ album, cardId, error });
      return;
    }

    const entry = { from_alias: cmdAlias, action: { args } };
    const nextCards = withCard(cards, cardId, entry);
    const nextQueue = buildQueue({ albums, cards: nextCards, compare: order.compare });

    setCards(nextCards);
    setSession(current => rememberBinding(current, { albumKey: album.key, cardId }));
    setBound({ album, cardId, number: album.position });
    setPosition(nextOpenIndex(nextQueue, position + 1));
    writeSeriesMemory({ source: provider, order: orderId, albumKey: album.key });
  }, [albums, cards, order, orderId, position, provider, queue]);

  const rebind = useCallback(async () => {
    if (!conflict) return;
    const { album, cardId, existing } = conflict;

    const actionData = albumActionData(album);
    const { command: cmdAlias } = getActionAndCommand(actionData);
    const args = getArgsValues(actionData);

    const { error } = await request('registerCard', {
      card_id: cardId,
      cmd_alias: cmdAlias,
      args,
      overwrite: true,
    });

    setConflict(null);
    if (error) {
      setFailure({ album, cardId, error });
      return;
    }

    const entry = { from_alias: cmdAlias, action: { args } };
    const nextCards = withCard(cards, cardId, entry);
    const nextQueue = buildQueue({ albums, cards: nextCards, compare: order.compare });

    setCards(nextCards);
    setSession(current => rememberBinding(current, { albumKey: album.key, cardId, previous: existing }));
    setBound({ album, cardId, number: album.position });
    setPosition(nextOpenIndex(nextQueue, position + 1));
    writeSeriesMemory({ source: provider, order: orderId, albumKey: album.key });
  }, [albums, cards, conflict, order, orderId, position, provider]);

  const undo = useCallback(async () => {
    const binding = lastBinding(session);
    if (!binding || cards === null) return;

    let nextCards;
    let error;

    if (binding.previous) {
      ({ error } = await request('registerCard', {
        card_id: binding.cardId,
        cmd_alias: binding.previous.from_alias,
        args: binding.previous.action?.args ?? undefined,
        ignore_card_removal_action: binding.previous.ignore_card_removal_action,
        ignore_same_id_delay: binding.previous.ignore_same_id_delay,
        overwrite: true,
      }));
      nextCards = withCard(cards, binding.cardId, binding.previous);
    }
    else {
      ({ error } = await request('deleteCard', { card_id: binding.cardId }));
      nextCards = withoutCard(cards, binding.cardId);
    }

    if (error) {
      setFailure({ album: queue[position], cardId: binding.cardId, error });
      return;
    }

    const nextQueue = buildQueue({ albums, cards: nextCards, compare: order.compare });
    const undoneIndex = indexOfAlbum(nextQueue, binding.albumKey);

    setCards(nextCards);
    setSession(current => forgetBinding(current));
    setBound(null);
    setFailure(null);

    // The queue returns to the album whose binding was undone while it is open.
    if (undoneIndex >= 0 && !nextQueue[undoneIndex].bound) setPosition(undoneIndex);
  }, [albums, cards, order, position, queue, session]);

  const reload = () => {
    setLoadError(null);
    setAttempt(current => current + 1);
  };

  const changeProvider = (nextProvider) => {
    setProvider(nextProvider);
    setStartIndex(-1);
  };

  const changeOrder = (nextOrderId) => {
    setOrderId(nextOrderId);
    setStartIndex(-1);
  };

  const start = () => {
    setPosition(startPosition >= 0 ? startPosition : 0);
    setView(VIEW_QUEUE);
  };

  const startHere = (index) => {
    setStartIndex(index);
    setPosition(index);
    setView(VIEW_QUEUE);
  };

  // A placement only binds while the queue is on screen: there the album that
  // is offered is the one the card belongs to.
  useEffect(() => {
    if (!placement || placement.serial <= handledPlacement.current) return;
    handledPlacement.current = placement.serial;
    if (view !== VIEW_QUEUE) return;

    bind(placement.cardId);
  }, [bind, placement, view]);

  const isLoading = isLoadingSources || isLoadingCards || isLoadingAlbums;

  let body;

  if (isLoading) {
    body = <Loading />;
  }
  else if (loadError) {
    body = (
      <Card elevation={0}>
        <CardContent>
          <Typography>{t('cards.series.loading-error')}</Typography>
          <Button onClick={reload} sx={{ marginTop: 'var(--space-4)' }} variant="contained">
            {t('cards.series.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }
  else if (view === VIEW_LIST) {
    body = (
      <SeriesList
        onBack={() => setView(VIEW_START)}
        onStartHere={startHere}
        position={position}
        queue={queue}
      />
    );
  }
  else if (view === VIEW_QUEUE && queue[position] && openAlbums > 0) {
    body = (
      <>
        <QueuePanel
          album={queue[position]}
          onBack={() => setView(VIEW_START)}
          onBind={bind}
          onOpenList={() => setView(VIEW_LIST)}
          openAlbums={openAlbums}
          position={queue[position].position}
          total={queue.length}
        />
        {conflict &&
          <ConflictPanel
            canRebind={isAlbumCard(conflict.existing)}
            cardId={conflict.cardId}
            existing={conflict.existing}
            onClose={() => setConflict(null)}
            onRebind={rebind}
          />
        }
        {failure &&
          <Card elevation={0}>
            <CardContent>
              <Typography>
                {t('cards.series.binding-failed', { error: failure.error })}
              </Typography>
              <Grid
                container
                sx={{ justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}
              >
                <Button onClick={() => setFailure(null)} variant="outlined">
                  {t('cards.series.dismiss')}
                </Button>
              </Grid>
            </CardContent>
          </Card>
        }
        {bound &&
          <BoundFeedback
            album={bound.album}
            cardId={bound.cardId}
            number={bound.number}
            onUndo={undo}
          />
        }
      </>
    );
  }
  else if (view === VIEW_QUEUE) {
    body = (
      <Card elevation={0}>
        <CardContent>
          <Typography variant="contentBody">
            {t('cards.series.exhausted', { count: queue.length })}
          </Typography>
          <Typography color="textSecondary" variant="contentBody">
            {t('cards.series.exhausted-hint')}
          </Typography>
          <Grid
            container
            sx={{ gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}
          >
            <Button onClick={() => setView(VIEW_LIST)} variant="outlined">
              {t('cards.series.open-list')}
            </Button>
            <Button
              component={Link}
              nativeButton={false}
              to="/cards"
              variant="contained"
            >
              {t('cards.series.to-cards')}
            </Button>
          </Grid>
        </CardContent>
      </Card>
    );
  }
  else {
    body = (
      <StartPanel
        canStart={canStart}
        emptySource={queue.length === 0}
        memoryNumber={rememberedIndex >= 0 ? queue[rememberedIndex].position : 0}
        onContinue={() => setStartIndex(continuing >= 0 ? continuing : firstOpen)}
        onOpenList={() => setView(VIEW_LIST)}
        onOrderChange={changeOrder}
        onProviderChange={changeProvider}
        onStart={start}
        orderId={orderId}
        provider={provider}
        sources={sources}
        startNumber={startNumber}
        total={queue.length}
      />
    );
  }

  return (
    <Grid container size={12} spacing={2} sx={{ alignContent: 'flex-start' }}>
      <Header backLink="/cards" title={t('cards.series.title')} />
      <Grid size={12} sx={{ display: 'grid', gap: 'var(--space-4)' }}>
        {body}
      </Grid>
    </Grid>
  );
};

export default CardsSeries;
