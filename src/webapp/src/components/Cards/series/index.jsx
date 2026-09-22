import { useEffect, useMemo, useState } from 'react';
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
import { flatByAlbum } from '../../../utils/utils';
import { loadRegisteredCards } from '../registered-cards';
import { orderById } from './orders';
import { buildQueue, nextOpenIndex, openCount } from './queue';
import { memoryPosition, readSeriesMemory } from './series-memory';
import QueuePanel from './queue-panel';
import SeriesList from './series-list';
import StartPanel from './start-panel';

const VIEW_START = 'start';
const VIEW_QUEUE = 'queue';
const VIEW_LIST = 'list';

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
      <QueuePanel
        album={queue[position]}
        onBack={() => setView(VIEW_START)}
        onOpenList={() => setView(VIEW_LIST)}
        openAlbums={openAlbums}
        position={queue[position].position}
        total={queue.length}
      />
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
      <Grid size={12}>{body}</Grid>
    </Grid>
  );
};

export default CardsSeries;
