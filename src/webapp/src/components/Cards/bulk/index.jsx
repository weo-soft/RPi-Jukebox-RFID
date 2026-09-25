import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router-dom';

import {
  Button,
  Card,
  CardContent,
  Grid,
  Typography,
} from '@mui/material';

import Header from '../../Header';
import { Loading } from '../../general';
import PubSubContext from '../../../context/pubsub/context';
import request from '../../../utils/request';
import { initSockets } from '../../../sockets';
import { flatByAlbum } from '../../../utils/utils';
import { buildActionData, getActionAndCommand, getArgsValues } from '../utils';
import { loadRegisteredCards, registeredEntry } from '../registered-cards';
import { holdingCard, isAlbumCard } from './keys';
import { orderById } from './orders';
import {
  buildQueue,
  indexOfAlbum,
  nextOpenIndex,
  openCount,
} from './queue';
import {
  memoryPosition,
  readBulkMemory,
  writeBulkMemory,
} from './bulk-memory';
import { createPlacementCounter } from './events';
import {
  EMPTY_SESSION,
  forgetBinding,
  lastBinding,
  rememberBinding,
  withCard,
  withoutCard,
} from './session';
import AlbumChoice from './album-choice';
import AlbumPicker from './album-picker';
import BoundFeedback from './bound-feedback';
import ConflictPanel from './conflict-panel';
import QueuePanel from './queue-panel';
import BulkList from './bulk-list';
import StartPanel from './start-panel';

const VIEW_START = 'start';
const VIEW_QUEUE = 'queue';
const VIEW_LIST = 'list';
const VIEW_PICKER = 'picker';
const VIEW_CHOICE = 'choice';

const albumActionData = (album) => buildActionData('play_music', 'play_album', {
  albumartist: album.albumartist,
  album: album.album,
  content_uri: album.content_uri,
  provider: album.provider,
});

/*
 * A bulk registration of cards: the albums of one source in one order, narrowed
 * to the albums chosen for it. The screen leads from its start area into the
 * choice, the queue
 * or the numbered list that brings the physical stack into the same order, and
 * it offers the free mode for cards that do not follow that order. What counts
 * as open follows from the inventory - an album is open while no card names it -
 * so no progress of its own has to be kept.
 */
const CardsBulk = () => {
  const { t } = useTranslation();
  const { state: published } = useContext(PubSubContext);
  const [searchParams] = useSearchParams();

  const [memory] = useState(() => readBulkMemory());
  const [attempt, setAttempt] = useState(0);
  const [view, setView] = useState(VIEW_START);
  // The way in decides the mode - the card list hands it over as a parameter and
  // the start area does not switch it again. Without one the run is the rule.
  const mode = searchParams.get('mode') === 'free' ? 'free' : 'guided';
  // The albums this registration runs over; without a selection it is the whole source.
  const [selection, setSelection] = useState(() => memory?.selection ?? null);
  const [lastAlbumKey, setLastAlbumKey] = useState(() => memory?.albumKey ?? '');
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
  const [albumConflict, setAlbumConflict] = useState(null);
  const [failure, setFailure] = useState(null);
  const [freeCardId, setFreeCardId] = useState(null);

  const publishedCardId = useRef(published);
  publishedCardId.current = published;
  // The value the stream already carried when this screen subscribed.
  const entryCardId = useRef(undefined);
  const isNewPlacement = useRef(createPlacementCounter());
  const placements = useRef(0);
  const handledPlacement = useRef(0);

  const isLoading = isLoadingSources || isLoadingCards || isLoadingAlbums;

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

  // Source, order, start point and the chosen albums are one state and are
  // written together, so a reload finds the same registration again.
  useEffect(() => {
    if (provider === null) return;

    writeBulkMemory({ source: provider, order: orderId, albumKey: lastAlbumKey, selection });
  }, [lastAlbumKey, orderId, provider, selection]);

  // The event stream carries the card placements. The broker repeats the cached
  // value on every subscription, and this screen subscribes once its data is
  // there: the value the app already holds at that moment comes back once more
  // and is the repetition, not a placement.
  useEffect(() => {
    if (isLoading) return undefined;

    entryCardId.current = publishedCardId.current['rfid.card_id'];
    return initSockets({ events: ['rfid.card_id'], setState: setEvents });
  }, [isLoading]);

  useEffect(() => {
    const cardId = events['rfid.card_id'];
    if (cardId === undefined) return;

    if (entryCardId.current !== undefined && entryCardId.current === cardId) {
      entryCardId.current = undefined;
      return;
    }

    if (!isNewPlacement.current({ cardId, at: Date.now() })) return;

    placements.current += 1;
    setPlacement({ cardId, serial: placements.current });
  }, [events]);

  const order = orderById(orderId);
  const queueOf = useCallback((cardsList) => buildQueue({
    albums,
    cards: cardsList,
    compare: order.compare,
    selection,
  }), [albums, order, selection]);
  // The whole source: the choice of the albums and the free mode work on it.
  const allQueue = useMemo(
    () => buildQueue({ albums, cards: cards ?? {}, compare: order.compare }),
    [albums, cards, order],
  );
  const queue = useMemo(() => queueOf(cards ?? {}), [cards, queueOf]);
  const sourceKeys = useMemo(() => new Set(allQueue.map(({ key }) => key)), [allQueue]);

  const openAlbums = openCount(queue);
  const firstOpen = nextOpenIndex(queue, 0);
  // The session starts at the first open album of the order; a remembered
  // start point is offered, not applied.
  const rememberedIndex = memoryPosition(queue, memory);
  const continuing = rememberedIndex >= 0 ? nextOpenIndex(queue, rememberedIndex + 1) : -1;
  const startPosition = startIndex >= 0 ? startIndex : firstOpen;
  const startNumber = startPosition >= 0 && queue[startPosition] ? queue[startPosition].position : 0;
  const canStart = openAlbums > 0;
  // A chosen album the source no longer delivers would leave the registration
  // silently, so it is named instead.
  const missingCount = selection === null
    ? 0
    : selection.albumKeys.filter(key => !sourceKeys.has(key)).length;

  const bindAlbum = useCallback(async (cardId, album) => {
    // Without the card list the conflict test would run into nothing.
    if (cards === null || !cardId || !album) return;

    setFailure(null);
    setAlbumConflict(null);

    const existing = registeredEntry(cards, cardId);
    if (existing) {
      setConflict({ album, cardId, existing });
      return;
    }

    setConflict(null);

    const holder = album.bound ? holdingCard(cards, album.key) : undefined;
    if (holder) {
      setAlbumConflict({ album, cardId, holderId: holder[0] });
      return;
    }

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
      // not a failure of the registration.
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
    const nextQueue = queueOf(nextCards);

    setCards(nextCards);
    setSession(current => rememberBinding(current, { albumKey: album.key, cardId }));
    setBound({ album, cardId, number: album.position });
    setPosition(nextOpenIndex(nextQueue, position + 1));
    setLastAlbumKey(album.key);
  }, [cards, position, queueOf]);

  const bind = useCallback(async (cardId) => {
    await bindAlbum(cardId, queue[position]);
  }, [bindAlbum, position, queue]);

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
    const nextQueue = queueOf(nextCards);

    setCards(nextCards);
    setSession(current => rememberBinding(current, { albumKey: album.key, cardId, previous: existing }));
    setBound({ album, cardId, number: album.position });
    setPosition(nextOpenIndex(nextQueue, position + 1));
    setLastAlbumKey(album.key);
  }, [cards, conflict, position, queueOf]);

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

    const nextQueue = queueOf(nextCards);
    const undoneIndex = indexOfAlbum(nextQueue, binding.albumKey);

    setCards(nextCards);
    setSession(current => forgetBinding(current));
    setBound(null);
    setFailure(null);

    // The queue returns to the album whose binding was undone while it is open.
    if (undoneIndex >= 0 && !nextQueue[undoneIndex].bound) setPosition(undoneIndex);
  }, [cards, position, queue, queueOf, session]);

  const reload = () => {
    setLoadError(null);
    setAttempt(current => current + 1);
  };

  const changeProvider = (nextProvider) => {
    setProvider(nextProvider);
    setStartIndex(-1);
    // Selection and start point both name albums of one source, so neither
    // carries over to another one.
    setSelection(null);
    setLastAlbumKey('');
  };

  const changeOrder = (nextOrderId) => {
    setOrderId(nextOrderId);
    setStartIndex(-1);
  };

  const start = () => {
    setPosition(startPosition >= 0 ? startPosition : 0);
    setFreeCardId(null);
    setView(mode === 'free' ? VIEW_PICKER : VIEW_QUEUE);
  };

  const startHere = (index) => {
    setStartIndex(index);
    setPosition(index);
    setView(VIEW_QUEUE);
  };

  const backToStart = () => {
    setFreeCardId(null);
    setView(VIEW_START);
  };

  // A placement binds in the queue and names the card in the free mode: there
  // the album is chosen afterwards.
  useEffect(() => {
    if (!placement || placement.serial <= handledPlacement.current) return;
    handledPlacement.current = placement.serial;

    if (view === VIEW_QUEUE) {
      bind(placement.cardId);
      return;
    }

    if (view === VIEW_PICKER) setFreeCardId(placement.cardId);
  }, [bind, placement, view]);

  const notices = (
    <>
      {conflict &&
        <ConflictPanel
          canRebind={isAlbumCard(conflict.existing)}
          cardId={conflict.cardId}
          existing={conflict.existing}
          onClose={() => setConflict(null)}
          onRebind={rebind}
        />
      }
      {albumConflict &&
        <Card elevation={0}>
          <CardContent>
            <Typography>
              {t('cards.bulk.album-conflict', {
                album: albumConflict.album.album || albumConflict.album.albumartist,
                cardId: albumConflict.holderId,
              })}
            </Typography>
            <Grid
              container
              sx={{ gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}
            >
              <Button onClick={() => setAlbumConflict(null)} variant="outlined">
                {t('cards.bulk.dismiss')}
              </Button>
              <Button
                component={Link}
                nativeButton={false}
                to={`/cards?search=${encodeURIComponent(albumConflict.holderId)}`}
                variant="contained"
              >
                {t('cards.bulk.conflict-list')}
              </Button>
            </Grid>
          </CardContent>
        </Card>
      }
      {failure &&
        <Card elevation={0}>
          <CardContent>
            <Typography>
              {t('cards.bulk.binding-failed', { error: failure.error })}
            </Typography>
            <Grid
              container
              sx={{ justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}
            >
              <Button onClick={() => setFailure(null)} variant="outlined">
                {t('cards.bulk.dismiss')}
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

  let body;

  if (isLoading) {
    body = <Loading />;
  }
  else if (loadError) {
    body = (
      <Card elevation={0}>
        <CardContent>
          <Typography>{t('cards.bulk.loading-error')}</Typography>
          <Button onClick={reload} sx={{ marginTop: 'var(--space-4)' }} variant="contained">
            {t('cards.bulk.retry')}
          </Button>
        </CardContent>
      </Card>
    );
  }
  else if (view === VIEW_CHOICE) {
    body = (
      <AlbumChoice
        albums={allQueue}
        onChange={setSelection}
        onBack={backToStart}
        selection={selection}
      />
    );
  }
  else if (view === VIEW_LIST) {
    body = (
      <BulkList
        onBack={backToStart}
        onStartHere={startHere}
        position={position}
        queue={queue}
      />
    );
  }
  else if (view === VIEW_PICKER) {
    body = (
      <>
        <AlbumPicker
          albums={allQueue}
          cardId={freeCardId}
          onBack={backToStart}
          onBind={(album) => bindAlbum(freeCardId, album)}
          onCardId={setFreeCardId}
        />
        {notices}
      </>
    );
  }
  else if (view === VIEW_QUEUE) {
    body = (
      <>
        {queue[position] && openAlbums > 0
          ? <QueuePanel
              album={queue[position]}
              onBack={backToStart}
              onBind={bind}
              onOpenList={() => setView(VIEW_LIST)}
              openAlbums={openAlbums}
              position={queue[position].position}
              total={queue.length}
            />
          : <Card elevation={0}>
              <CardContent>
          <Typography variant="contentBody">
            {t('cards.bulk.exhausted', { count: queue.length })}
          </Typography>
          <Typography color="textSecondary" variant="contentBody">
            {t('cards.bulk.exhausted-hint')}
          </Typography>
          <Grid
            container
            sx={{ gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}
          >
            <Button onClick={() => setView(VIEW_LIST)} variant="outlined">
              {t('cards.bulk.open-list')}
            </Button>
            <Button
              component={Link}
              nativeButton={false}
              to="/cards"
              variant="contained"
            >
              {t('cards.bulk.to-cards')}
            </Button>
          </Grid>
              </CardContent>
            </Card>
        }
        {notices}
      </>
    );
  }
  else {
    body = (
      <StartPanel
        canStart={canStart}
        emptySelection={selection !== null && queue.length === 0}
        emptySource={allQueue.length === 0}
        isSelected={selection !== null}
        memoryNumber={rememberedIndex >= 0 ? queue[rememberedIndex].position : 0}
        missingCount={missingCount}
        mode={mode}
        onChoose={() => setView(VIEW_CHOICE)}
        onClearSelection={() => setSelection(null)}
        onContinue={() => setStartIndex(continuing >= 0 ? continuing : firstOpen)}
        onOpenList={() => setView(VIEW_LIST)}
        onOrderChange={changeOrder}
        onProviderChange={changeProvider}
        onStart={start}
        openAlbums={openAlbums}
        orderId={orderId}
        provider={provider}
        selectedCount={queue.length}
        sources={sources}
        startNumber={startNumber}
        total={queue.length}
      />
    );
  }

  // The way out: from a sub view the header steps back into the start area, and
  // only the start area leaves the screen for the card list.
  const atStart = view === VIEW_START;

  return (
    <Grid container id="cards-bulk" size={12} spacing={2} sx={{ alignContent: 'flex-start' }}>
      <Header
        backLink={atStart ? '/cards' : undefined}
        onBack={atStart ? undefined : backToStart}
        title={t('cards.bulk.title')}
      />
      <Grid size={12} sx={{ display: 'grid', gap: 'var(--space-4)' }}>
        {body}
      </Grid>
    </Grid>
  );
};

export default CardsBulk;
