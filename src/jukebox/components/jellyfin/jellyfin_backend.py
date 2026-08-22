"""Jellyfin player backend: Jellyfin catalog with MPD-based audio playback.

The backend owns its catalog and status while active and delegates the actual
audio transport and the coordinator's transport controls to the injected MPD
backend.
"""

import logging
import queue
import threading
import time
from pathlib import Path

import jukebox.cfghandler
import jukebox.multitimer as multitimer
import jukebox.publishing as publishing


ALBUM_URI_PREFIX = 'service:jellyfin:album:'
TRACK_URI_PREFIX = 'service:jellyfin:track:'

#: Albums fetched per catalog page while building the cache. Keeps every
#: request bounded so large libraries cannot exhaust the request timeout.
ALBUM_PAGE_SIZE = 500

logger = logging.getLogger('jb.player.jellyfin')


def component_id_from_uri(uri, prefix=None):
    """Extract the Jellyfin item id from a stable ``service:jellyfin:*`` URI.

    With ``prefix`` only that exact URI kind is matched; without it both the
    album and the track prefix are tried.
    """
    if not isinstance(uri, str):
        return None
    if prefix is not None:
        if uri.startswith(prefix):
            return uri[len(prefix):]
        return None
    for candidate in (ALBUM_URI_PREFIX, TRACK_URI_PREFIX):
        if uri.startswith(candidate):
            return uri[len(candidate):]
    return None


class JellyfinBackend:
    """Duck-typed player backend exposing a Jellyfin catalog and MPD playback."""

    def __init__(self, api, mpd, cache_ttl=300.0):
        self._api = api
        self._mpd = mpd
        self._active = False
        # stream URL -> {uri, title, artist, album, duration, track, item_id}
        self._stream_to_track = {}
        self._catalog_cache = None
        self._catalog_cache_ts = 0.0
        self._cache_ttl = float(cache_ttl or 300)
        self._cover_cache_dir = Path(
            jukebox.cfghandler.get_handler('jukebox').setndefault(
                'webapp', 'coverart_cache_path',
                value='../../src/webapp/build/cover-cache')
        ).expanduser()
        # Cover art is resolved lazily (memoized per item) and written by a
        # background worker so neither playback nor the status poller ever
        # blocks on network or disk I/O.
        self._cover_memo = {}
        self._cover_write_queue = queue.Queue()
        self._cover_worker = threading.Thread(
            target=self._cover_worker_loop, daemon=True)
        self._cover_worker.start()
        self._status_timer = multitimer.GenericEndlessTimerClass(
            'jellyfin.timer_status', 0.25, self._publish_status)
        self._status_timer.start()

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def exit(self):
        """Close the status poller and the HTTP session."""
        if self._status_timer is not None:
            self._status_timer.close()
            self._status_timer = None
        if self._api is not None:
            self._api.close()
            self._api = None
        self._catalog_cache = None
        self._catalog_cache_ts = 0.0

    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    def library_source(self):
        return {
            'id': 'jellyfin',
            'label': 'Jellyfin',
            'views': [
                {'id': 'albums', 'label': 'Albums',
                 'kind': 'items', 'content_types': ['album']},
            ],
        }

    def list_library_items(self, content_types=None):
        if content_types is not None and 'album' not in content_types:
            return []
        items = []
        for album in self._get_cached_albums():
            album_id = album.get('Id')
            if not album_id:
                continue
            items.append({
                'provider': 'jellyfin',
                'content_type': 'album',
                'content_uri': f'{ALBUM_URI_PREFIX}{album_id}',
                'albumartist': album.get('AlbumArtist', ''),
                'album': album.get('Name', ''),
                'cover_url': None,
            })
        return items

    def _get_cached_albums(self):
        """Return the album catalog, refreshing it when the TTL expired."""
        now = time.monotonic()
        if (self._catalog_cache is not None
                and now - self._catalog_cache_ts < self._cache_ttl):
            return self._catalog_cache
        try:
            albums = self._fetch_all_albums()
        except Exception as error:
            if self._catalog_cache is not None:
                logger.warning(
                    "Jellyfin catalog refresh failed; serving cached catalog: %s",
                    error)
                return self._catalog_cache
            raise
        self._catalog_cache = albums
        self._catalog_cache_ts = now
        return albums

    def _fetch_all_albums(self):
        """Fetch the full album catalog in bounded pages.

        Requests a page of :data:`ALBUM_PAGE_SIZE` albums at a time so a
        large library never needs a single oversized request. Stops as soon
        as a page is shorter than the page size.
        """
        albums = []
        start_index = 0
        while True:
            page = self._api.get_albums(
                limit=ALBUM_PAGE_SIZE, start_index=start_index)
            albums.extend(page)
            if len(page) < ALBUM_PAGE_SIZE:
                break
            start_index += ALBUM_PAGE_SIZE
        return albums

    def _find_album_id(self, albumartist, album):
        """Resolve an album item id from the cached catalog by name/artist."""
        if not album:
            return None
        for candidate in self._get_cached_albums():
            if candidate.get('Name') != album:
                continue
            if not albumartist:
                return candidate.get('Id')
            if (candidate.get('AlbumArtist') or '') == (albumartist or ''):
                return candidate.get('Id')
        return None

    def _content_uri_to_album_id(self, content_uri):
        if not content_uri:
            return None
        return component_id_from_uri(content_uri, prefix=ALBUM_URI_PREFIX)

    def list_songs_by_artist_and_album(
            self, albumartist, album, content_uri=None, provider=None):
        album_id = (self._content_uri_to_album_id(content_uri)
                    or self._find_album_id(albumartist, album))
        if album_id is None:
            return []
        try:
            tracks = self._api.get_album_children(album_id)
        except Exception as error:
            logger.error("Jellyfin song list failed: %s", error)
            return []
        return [
            self._track_metadata(track)
            for track in tracks
            if track.get('Id')
        ]

    def get_song_by_url(self, song_url, provider=None):
        track_id = component_id_from_uri(song_url)
        if track_id is None:
            return []
        try:
            item = self._api.get_item(track_id)
        except Exception as error:
            logger.error("Jellyfin get_song_by_url failed: %s", error)
            return []
        if not item or item.get('Type') != 'Audio':
            return []
        return [self._track_metadata(item)]

    def _track_metadata(self, item):
        """Return a unified track dict from a Jellyfin Audio item."""
        return {
            'provider': 'jellyfin',
            'album': item.get('Album', ''),
            'artist': ', '.join(item.get('Artists') or []),
            'title': item.get('Name', ''),
            'file': f'{TRACK_URI_PREFIX}{item["Id"]}',
            'track': item.get('IndexNumber'),
            'duration': (item.get('RunTimeTicks') or 0) // 10_000_000,
            'cover_url': None,
        }

    # ------------------------------------------------------------------
    # Playback
    # ------------------------------------------------------------------

    def play_album(self, albumartist, album, content_uri=None, provider=None):
        album_id = (self._content_uri_to_album_id(content_uri)
                    or self._find_album_id(albumartist, album))
        if album_id is None:
            logger.warning("Jellyfin album not found: '%s' by '%s'", album, albumartist)
            return
        try:
            tracks = self._api.get_album_children(album_id)
        except Exception as error:
            logger.error("Jellyfin play_album failed: %s", error)
            return
        stream_to_track = {
            self._api.get_stream_url(track['Id']): self._track_info(track)
            for track in tracks
            if track.get('Id')
        }
        self._play_streams(list(stream_to_track), stream_to_track)

    def play_single(self, song_url, provider=None):
        track_id = component_id_from_uri(song_url)
        if track_id is None:
            logger.warning("Invalid Jellyfin track URI: '%s'", song_url)
            return
        try:
            item = self._api.get_item(track_id)
        except Exception as error:
            logger.error("Jellyfin play_single failed: %s", error)
            return
        if not item:
            logger.warning("Jellyfin track not found: '%s'", song_url)
            return
        stream_url = self._api.get_stream_url(track_id)
        self._play_streams([stream_url], {stream_url: self._track_info(item)})

    def play_folder(self, folder, recursive=False):
        """Play an album or single-track URI supplied by a card swipe."""
        track_id = component_id_from_uri(folder, prefix=TRACK_URI_PREFIX)
        if track_id is not None:
            return self.play_single(folder)
        album_id = component_id_from_uri(folder, prefix=ALBUM_URI_PREFIX)
        if album_id is not None:
            return self.play_album(None, None, content_uri=folder)
        logger.warning("Unrecognized Jellyfin card value: '%s'", folder)

    def is_second_swipe(self, folder):
        """No second-swipe action for Jellyfin content."""
        return False

    def _track_info(self, item):
        """Unified track metadata for the stream->track status map."""
        return {
            'uri': f'{TRACK_URI_PREFIX}{item["Id"]}',
            'title': item.get('Name', ''),
            'artist': ', '.join(item.get('Artists') or []),
            'album': item.get('Album', ''),
            'duration': (item.get('RunTimeTicks') or 0) // 10_000_000,
            'track': item.get('IndexNumber'),
            'item_id': item['Id'],
        }

    def _play_streams(self, stream_urls, stream_to_track=None):
        if not stream_urls:
            logger.warning("No Jellyfin streams to play")
            return
        self._mpd.clear_playlist()
        for url in stream_urls:
            self._mpd.add_to_playlist(url)
        self._mpd.play()
        # Remember the stream URL -> track-metadata mapping for playerstatus.
        # Set on every playback path (album and single track) so the
        # normalized status never exposes the raw stream URL (API key).
        self._stream_to_track = stream_to_track or {}
        logger.info("Playing %d Jellyfin stream(s)", len(stream_urls))

    # ------------------------------------------------------------------
    # Cover art
    # ------------------------------------------------------------------

    def get_single_coverart(self, song_url, provider=None):
        track_id = component_id_from_uri(song_url)
        if track_id is None:
            # Defensive: a client may pass the raw MPD stream URL instead of
            # the stable URI — reverse-map it.
            track = self._stream_to_track.get(song_url)
            if track is not None:
                track_id = component_id_from_uri(track['uri'])
        if track_id is None:
            return None
        return self._cache_coverart(track_id)

    def get_album_coverart(self, albumartist, album, content_uri=None, provider=None):
        album_id = (self._content_uri_to_album_id(content_uri)
                    or self._find_album_id(albumartist, album))
        return self._cache_coverart(album_id) if album_id else None

    def _cache_coverart(self, item_id):
        """Return the cached cover filename for ``item_id``, downloading lazily.

        Memoized (at most one download per item) and non-blocking: the first
        call enqueues the download on the background cover worker and returns
        ``None``; later calls return the bare filename once the worker has
        finished.
        """
        if item_id is None:
            return None
        if item_id in self._cover_memo:
            return self._cover_memo[item_id] or None
        self._cover_memo[item_id] = None
        self._cover_write_queue.put(item_id)
        return None

    def _cover_worker_loop(self):
        """Background worker downloading and writing cover images."""
        while True:
            item_id = self._cover_write_queue.get()
            try:
                image_bytes = self._api.get_coverart_bytes(item_id)
                filename = f'jellyfin-{item_id}.jpg'
                (self._cover_cache_dir / filename).write_bytes(image_bytes)
            except Exception as error:
                logger.warning(
                    "Could not fetch Jellyfin cover art for %s: %s", item_id, error)
                self._cover_memo[item_id] = None
            else:
                self._cover_memo[item_id] = filename
            finally:
                self._cover_write_queue.task_done()

    def _cover_url(self, item_id):
        """Prefixed ``/cover-cache/`` URL for the playerstatus cover field."""
        filename = self._cache_coverart(item_id)
        return f'/cover-cache/{filename}' if filename else None

    # ------------------------------------------------------------------
    # Status
    # ------------------------------------------------------------------

    def set_active(self, active):
        self._active = active
        if active:
            self._publish_status()

    def _publish_status(self):
        if not self._active or self._mpd is None:
            return
        mpd_status = dict(self._mpd.mpd_status)
        publishing.get_publisher().send(
            'playerstatus', self._normalize_status(mpd_status))

    def _normalize_status(self, mpd_status):
        """Build the complete status from MPD state and Jellyfin metadata."""
        file_url = mpd_status.get('file')
        track = self._stream_to_track.get(file_url) or {}
        return {
            'state': mpd_status.get('state', 'stop'),
            'songid': track.get('uri') or mpd_status.get('songid'),
            'song': mpd_status.get('song', ''),
            'elapsed': mpd_status.get('elapsed', '0.0'),
            'random': mpd_status.get('random', '0'),
            'repeat': mpd_status.get('repeat', '0'),
            'single': mpd_status.get('single', '0'),
            'title': track.get('title', ''),
            'artist': track.get('artist', ''),
            'album': track.get('album', ''),
            'duration': str(track.get('duration', 0)),
            'file': track.get('uri') or file_url,
            'provider': 'jellyfin',
            'cover_url': self._cover_url(track.get('item_id')),
        }

    def get_player_type_and_version(self):
        return self._mpd.get_player_type_and_version()

    # ------------------------------------------------------------------
    # Active-backend delegation to MPD
    # ------------------------------------------------------------------

    def stop(self):
        return self._mpd.stop()

    def play(self):
        return self._mpd.play()

    def pause(self, state=1):
        return self._mpd.pause(state)

    def prev(self):
        return self._mpd.prev()

    def next(self):
        return self._mpd.next()

    def seek(self, new_time):
        return self._mpd.seek(new_time)

    def rewind(self):
        return self._mpd.rewind()

    def replay(self):
        """Restart the current Jellyfin track from the beginning."""
        self._mpd.seek(0)
        return self._mpd.play()

    def toggle(self):
        return self._mpd.toggle()

    def replay_if_stopped(self):
        """Restart the current Jellyfin playlist if MPD is stopped."""
        if self._mpd.mpd_status.get('state') == 'stop':
            return self._mpd.rewind()

    def resume(self):
        """Resume the current Jellyfin playlist from the saved position."""
        songpos = self._mpd.mpd_status.get('song', 0)
        elapsed = self._mpd.mpd_status.get('elapsed', '0')
        with self._mpd.mpd_lock:
            self._mpd.mpd_client.seek(songpos, elapsed)
            self._mpd.mpd_client.play()

    def shuffle(self, option='toggle'):
        return self._mpd.shuffle(option)

    def repeat(self, option='toggle'):
        return self._mpd.repeat(option)

    def get_current_song(self, param=None):
        status = self._normalize_status(self._mpd.playerstatus())
        return status.get(param) if param else status

    def playerstatus(self):
        return self._normalize_status(self._mpd.playerstatus())

    def playlistinfo(self):
        return [self._normalize_status(self._mpd.playerstatus())]

    def get_volume(self):
        return self._mpd.get_volume()

    def set_volume(self, volume):
        return self._mpd.set_volume(volume)
