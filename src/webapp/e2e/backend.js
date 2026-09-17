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
    failRpc = false,
    rpcGate,
    showCovers = false,
    streamingLibrary = false,
    timerEvents = {},
  } = {},
) {
  const eventSockets = new Set();
  const libraryCalls = [];
  const rpcCalls = [];
  const subscribedTopics = new Set();

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

  await page.route('**/api/v1/rpc', async route => {
    const request = route.request();
    const payload = request.postDataJSON();
    rpcCalls.push(payload);

    if (rpcGate) {
      await rpcGate;
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
    if (key === 'get_app_settings') {
      result = { show_covers: showCovers };
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
      ];
    }
    if (key === 'list_library_items') {
      const localItems = rpcResults.list_albums.flatMap(entry => (
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
      result = [...localItems, ...streamingItems].filter(item => (
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
        const events = { ...socketEvents, ...timerEvents };
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
