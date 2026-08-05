"""
Jellyfin MediaProvider implementing the MediaProvider interface.

Uses MPD as the audio playback backend (HTTP stream URLs). Does NOT
override play_card() — second-swipe detection is inherited from the
MediaProvider base class.

RPC: Registered as jellyfin.provider.*.
"""

import logging
from typing import Optional

import jukebox.cfghandler
import jukebox.plugs as plugs
from jukebox.mediaprovider import MediaProvider

logger = logging.getLogger('jb.jellyfin.provider')
cfg = jukebox.cfghandler.get_handler('jukebox')


class JellyfinMediaProvider(MediaProvider):
    """
    MediaProvider that uses Jellyfin as a media source.

    Inherits play_card() from MediaProvider base class for
    second-swipe logic. MPD is used as the audio playback backend
    (HTTP stream URLs).

    All RPC-callable methods are decorated with @plugs.tag.
    """

    def __init__(self, mpd_backend: MediaProvider):
        """
        :param mpd_backend: MPD provider as audio playback backend
        """
        super().__init__()
        self._api: Optional['JellyfinApiClient'] = None  # noqa: F821
        self._mpd = mpd_backend

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def initialize(self):
        """
        Connect to Jellyfin server.

        Reads configuration from jukebox.yaml:
          jellyfin.host (required)
          jellyfin.api_key (preferred auth method)
          jellyfin.username + jellyfin.password (fallback auth)

        Validates that host is present. At least one auth method
        (api_key or username+password) must be configured.
        """
        host = cfg.getn('jellyfin', 'host', default=None)
        api_key = cfg.getn('jellyfin', 'api_key', default=None)
        username = cfg.getn('jellyfin', 'username', default=None)
        password = cfg.getn('jellyfin', 'password', default=None)

        if not host:
            raise ValueError(
                "Jellyfin configuration incomplete: "
                "'jellyfin.host' is not set"
            )
        if not api_key and not (username and password):
            raise ValueError(
                "Jellyfin configuration incomplete: must set either "
                "('jellyfin.api_key') or "
                "('jellyfin.username' + 'jellyfin.password')"
            )

        from .jellyfin_api_client import JellyfinApiClient
        self._api = JellyfinApiClient(
            host, api_key=api_key or '',
            username=username or '', password=password or '',
        )
        self._api.authenticate()
        logger.info(f"JellyfinMediaProvider initialized. Server: {host}")

    def shutdown(self):
        """Clean shutdown — close API session."""
        if self._api:
            self._api.close()
        self._api = None
        logger.info("JellyfinMediaProvider shut down")

    # ------------------------------------------------------------------
    # Playback
    # ------------------------------------------------------------------

    @plugs.tag
    def play_folder(self, folder: str, recursive: bool = False):
        """
        Play a Jellyfin folder / album / playlist.

        'folder' is a Jellyfin item ID. Resolves to audio items and
        plays via MPD (HTTP stream URLs). Called by the inherited
        base class play_card() on first swipe.

        :param folder: Jellyfin item ID
        :param recursive: If True, include items from sub-folders
        """
        items = self._api.get_items_in_folder(folder, recursive=recursive)
        audio_items = [
            item for item in items
            if item.get('Type') == 'Audio'
        ]

        if not audio_items:
            logger.warning(
                f"No audio items found in Jellyfin folder {folder}"
            )
            return

        self._mpd.stop()
        self._mpd.clear_playlist()
        for item in audio_items:
            stream_url = self._api.get_stream_url(item['Id'])
            self._mpd.add_to_playlist(stream_url)

        self._mpd.play()
        logger.info(
            f"Playing {len(audio_items)} tracks from folder {folder}"
        )

    @plugs.tag
    def play_single(self, song_url: str):
        """
        Play a single track by its Jellyfin item ID.

        :param song_url: Jellyfin item ID
        """
        stream_url = self._api.get_stream_url(song_url)
        self._mpd.stop()
        self._mpd.clear_playlist()
        self._mpd.add_to_playlist(stream_url)
        self._mpd.play()

    @plugs.tag
    def play_album(self, albumartist: str, album: str):
        """
        Play an album by looking it up in Jellyfin.

        :param albumartist: Album artist name
        :param album: Album name
        """
        albums = self._api.get_albums()
        target = [a for a in albums if a.get('Name') == album]
        if target:
            self.play_folder(target[0]['Id'])
        else:
            logger.warning(
                f"Album '{album}' not found in Jellyfin library"
            )

    # ------------------------------------------------------------------
    # Status (delegates to MPD)
    # ------------------------------------------------------------------

    @plugs.tag
    def status(self) -> dict:
        return self._mpd.status()

    @plugs.tag
    def get_current_song(self) -> Optional[dict]:
        return self._mpd.get_current_song()

    @plugs.tag
    def playlistinfo(self) -> list:
        return self._mpd.playlistinfo()

    # ------------------------------------------------------------------
    # Playback control (delegates to MPD)
    # ------------------------------------------------------------------

    @plugs.tag
    def play(self):
        self._mpd.play()

    @plugs.tag
    def stop(self):
        self._mpd.stop()

    @plugs.tag
    def next(self):
        self._mpd.next()

    @plugs.tag
    def prev(self):
        self._mpd.prev()

    @plugs.tag
    def toggle(self):
        self._mpd.toggle()

    @plugs.tag
    def pause(self, state: int = 1):
        self._mpd.pause(state)

    @plugs.tag
    def seek(self, new_time: float):
        self._mpd.seek(new_time)

    @plugs.tag
    def rewind(self):
        self._mpd.rewind()

    @plugs.tag
    def clear_playlist(self):
        self._mpd.clear_playlist()

    @plugs.tag
    def add_to_playlist(self, song_url: str):
        self._mpd.add_to_playlist(song_url)

    # ------------------------------------------------------------------
    # Library (via Jellyfin API)
    # ------------------------------------------------------------------

    @plugs.tag
    def list_albums(self) -> list:
        return self._api.get_albums()

    @plugs.tag
    def get_folder_content(self, folder: str) -> list:
        return self._api.get_items_in_folder(folder)

    @plugs.tag
    def list_all_dirs(self) -> list:
        return self._api.get_views()

    # ------------------------------------------------------------------
    # Cover Art
    # ------------------------------------------------------------------

    @plugs.tag
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        return self._api.get_coverart_url(song_url)

    @plugs.tag
    def get_album_coverart(self, albumartist: str,
                           album: str) -> Optional[str]:
        albums = self._api.get_albums()
        target = [a for a in albums if a.get('Name') == album]
        if target:
            return self._api.get_coverart_url(target[0]['Id'])
        return None

    # ------------------------------------------------------------------
    # Library Management
    # ------------------------------------------------------------------

    @plugs.tag
    def update(self):
        """Jellyfin updates are server-managed. No-op."""
        pass

    @plugs.tag
    def update_wait(self):
        self.update()

    @plugs.tag
    def get_player_type_and_version(self) -> str:
        return (
            f"jellyfin (via {self._mpd.get_player_type_and_version()})"
        )
