export const rpcResults = {
  get_app_settings: { show_covers: false },
  get_autohotspot_status: 'inactive',
  get_disk_usage: { used: 8_000, total: 32_000 },
  get_folder_content: [
    {
      name: 'Albums',
      relpath: 'Music/Rock/Albums',
      type: 'directory',
    },
    {
      name: 'sample.mp3',
      relpath: 'Music/Rock/sample.mp3',
      type: 'file',
    },
  ],
  get_ip_address: '192.168.1.42',
  get_outputs: {
    active_sink: 'speaker',
    sink_list: [
      { alias: 'Built-in speaker', pulse_sink_name: 'speaker' },
      { alias: 'USB audio', pulse_sink_name: 'usb' },
    ],
  },
  get_soft_max_volume: 80,
  get_state: {
    enabled: false,
    remaining_seconds: 0,
    running: false,
  },
  get_volume: 42,
  get_single_coverart: 'test-cover.png',
  list_albums: [
    { albumartist: 'Daft Punk', album: ['Discovery', 'Random Access Memories'] },
    { albumartist: 'Massive Attack', album: 'Mezzanine' },
  ],
  list_songs_by_artist_and_album: [
    {
      album: 'Bedtime Stories',
      artist: 'Storyteller',
      duration: 180,
      file: 'service:track:chapter-one',
      provider: 'streaming',
      title: 'Chapter One',
      track: '1',
    },
  ],
  list_cards: {
    '0001234567': {
      action: { args: [] },
      from_alias: '',
      func: 'play',
    },
  },
};

export const socketEvents = {
  'batt_status': { charging: false, soc: 76 },
  'core.plugins.loaded': { battmon: true },
  'core.version': '3.7.0-alpha',
  'host.temperature.cpu': '47.2',
  'host.timer.cputemp': { enabled: true },
  'playerstatus': {
    album: 'Discovery',
    artist: 'Daft Punk',
    duration: '224',
    elapsed: '42',
    file: 'Daft Punk/Discovery/One More Time.mp3',
    random: '0',
    repeat: '0',
    single: '0',
    songid: '1',
    state: 'play',
    title: 'One More Time',
  },
  'volume.level': { mute: false, volume: 42 },
};

export async function mockBackend(
  page,
  {
    albums,
    cards,
    cachedCardId,
    coverGate,
    failRpc = false,
    rpcGate,
    showCovers = false,
    streamingLibrary = false,
    spotifyConnected = true,
    spotifyLibrary = false,
    timerEvents = {},
  } = {},
) {
  const eventSockets = new Set();
  const libraryCalls = [];
  const rpcCalls = [];
  let spotifyLibraryState = { mode: 'account', items: [] };
  const subscribedTopics = new Set();
  // The card database of the mock follows registrations and deletions, and the
  // event cache keeps the last value of every published topic - the broker of
  // the core repeats it on every subscription.
  const cardEntries = { ...(cards ?? rpcResults.list_cards) };
  const lastEvents = {};
  if (cachedCardId !== undefined) lastEvents['rfid.card_id'] = cachedCardId;

  await page.addInitScript(() => {
    window.localStorage.setItem('i18nextLng', 'en');
  });

  await page.route('**/api/v1/library/entries**', async route => {
    const requestUrl = new URL(route.request().url());
    libraryCalls.push(requestUrl.searchParams.get('folder'));
    await route.fulfill({
      body: JSON.stringify({
        entries: rpcResults.get_folder_content,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.route('**/api/v1/spotify', route => route.fulfill({
    body: JSON.stringify({
      configured: true,
      connected: spotifyConnected,
      device_name: 'Phoniebox',
      enabled: true,
      redirect_uri: 'https://box.example/api/v1/spotify/oauth/callback',
    }),
    contentType: 'application/json',
    status: 200,
  }));

  await page.route('**/api/v1/spotify/oauth/start', route => {
    const origin = new URL(route.request().url()).origin;
    return route.fulfill({
      body: JSON.stringify({
        authorization_url: `${origin}/logo192.png#spotify-authorize`,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.route('**/api/v1/spotify/library', async route => {
    const request = route.request();
    if (request.method() === 'PUT') {
      spotifyLibraryState = {
        ...spotifyLibraryState,
        mode: request.postDataJSON().mode,
      };
    }
    await route.fulfill({
      body: JSON.stringify(spotifyLibraryState),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.route('**/api/v1/spotify/library/items', async route => {
    const request = route.request();
    if (request.method() === 'POST') {
      const item = {
        album: 'Quiet Time',
        albumartist: 'Family',
        content_type: 'playlist',
        content_uri: 'spotify:playlist:quiet-time',
        cover_url: null,
        provider: 'spotify',
      };
      spotifyLibraryState = {
        ...spotifyLibraryState,
        items: [...spotifyLibraryState.items, item],
      };
      await route.fulfill({
        body: JSON.stringify({ item }),
        contentType: 'application/json',
        status: 201,
      });
      return;
    }
    const { uri, uris } = request.postDataJSON();
    const removedUris = new Set(uris || [uri]);
    spotifyLibraryState = {
      ...spotifyLibraryState,
      items: spotifyLibraryState.items.filter(
        item => !removedUris.has(item.content_uri),
      ),
    };
    await route.fulfill({
      body: JSON.stringify(spotifyLibraryState),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.route('**/api/v1/rpc', async route => {
    const request = route.request();
    const payload = request.postDataJSON();
    rpcCalls.push(payload);

    if (rpcGate) {
      await rpcGate;
    }

    if (coverGate && (payload.method || payload.plugin) === 'get_single_coverart') {
      await coverGate;
    }

    if (failRpc) {
      await route.fulfill({
        body: JSON.stringify({ error: 'Backend unavailable' }),
        contentType: 'application/json',
        status: 503,
      });
      return;
    }

    const key = payload.method || payload.plugin;
    let result = rpcResults[key] ?? null;
    if (key === 'list_cards') {
      result = cardEntries;
    }
    if (key === 'register_card') {
      // The shape of the decoded entry, as list_cards delivers it.
      cardEntries[payload.kwargs.card_id] = {
        from_alias: payload.kwargs.cmd_alias,
        action: { args: payload.kwargs.args },
        ...(payload.kwargs.ignore_same_id_delay !== undefined && {
          ignore_same_id_delay: payload.kwargs.ignore_same_id_delay,
        }),
      };
      result = null;
    }
    if (key === 'delete_card') {
      delete cardEntries[payload.kwargs.card_id];
      result = null;
    }
    if (key === 'get_app_settings') {
      result = { show_covers: showCovers };
    }
    if (
      key === 'list_songs_by_artist_and_album' &&
      payload.kwargs.provider === 'spotify'
    ) {
      result = rpcResults.list_songs_by_artist_and_album.map(song => ({
        ...song,
        file: 'spotify:track:chapter-one',
        provider: 'spotify',
      }));
    }
    if (key === 'list_library_sources') {
      result = [
        {
          id: 'mpd',
          label: 'Local',
          views: [
            {
              id: 'albums',
              label: 'Albums',
              kind: 'items',
              content_types: ['album'],
            },
            {
              id: 'folders',
              label: 'Folders',
              kind: 'folders',
              content_types: [],
            },
          ],
        },
        ...(streamingLibrary ? [{
          id: 'streaming',
          label: 'Streaming',
          views: [
            {
              id: 'playlists',
              label: 'Playlists',
              kind: 'items',
              content_types: ['playlist'],
            },
          ],
        }] : []),
        {
          id: 'spotify',
          label: 'Spotify',
          views: [
            {
              id: 'albums',
              label: 'Albums',
              kind: 'items',
              content_types: ['album'],
            },
            {
              id: 'playlists',
              label: 'Playlists',
              kind: 'items',
              content_types: ['playlist'],
            },
            {
              id: 'tracks',
              label: 'Tracks',
              kind: 'items',
              content_types: ['track', 'collection'],
            },
          ],
        },
      ];
    }
    if (key === 'list_library_items') {
      const localItems = (albums ?? rpcResults.list_albums).flatMap(entry => (
        (Array.isArray(entry.album) ? entry.album : [entry.album]).map(album => ({
          ...entry,
          album,
          content_type: 'album',
          provider: 'mpd',
        }))
      ));
      const streamingItems = streamingLibrary ? [{
        albumartist: 'Family',
        album: 'Bedtime Stories',
        content_type: 'playlist',
        content_uri: 'service:playlist:bedtime',
        provider: 'streaming',
      }] : [];
      const spotifyItems = spotifyLibraryState.mode === 'curated'
        ? spotifyLibraryState.items
        : (spotifyLibrary ? [{
          albumartist: 'Family',
          album: 'Bedtime Stories',
          content_type: 'playlist',
          content_uri: 'spotify:playlist:bedtime',
          provider: 'spotify',
        }] : []);
      result = [...localItems, ...streamingItems, ...spotifyItems].filter(item => (
        (!payload.kwargs.provider || item.provider === payload.kwargs.provider) &&
        (
          !payload.kwargs.content_types ||
          payload.kwargs.content_types.includes(item.content_type)
        )
      ));
    }
    await route.fulfill({
      body: JSON.stringify({
        id: payload.id,
        result,
      }),
      contentType: 'application/json',
      status: 200,
    });
  });

  await page.route('**/cover-cache/test-cover.png', route => route.fulfill({
    contentType: 'image/png',
    path: 'public/logo192.png',
    status: 200,
  }));

  await page.routeWebSocket('**/api/v1/events', socket => {
    eventSockets.add(socket);
    socket.onMessage(message => {
      const payload = JSON.parse(message);
      if (payload.type !== 'subscribe') {
        return;
      }

      payload.topics.forEach(topic => {
        subscribedTopics.add(topic);
        const events = { ...socketEvents, ...timerEvents, ...lastEvents };
        if (topic in events) {
          socket.send(JSON.stringify({
            type: 'event',
            topic,
            data: events[topic],
          }));
        }
      });
    });
  });

  const publishEvent = (topic, data) => {
    lastEvents[topic] = data;
    eventSockets.forEach(socket => {
      socket.send(JSON.stringify({
        type: 'event',
        topic,
        data,
      }));
    });
  };

  return {
    libraryCalls,
    publishEvent,
    rpcCalls,
    subscribedTopics,
  };
}
