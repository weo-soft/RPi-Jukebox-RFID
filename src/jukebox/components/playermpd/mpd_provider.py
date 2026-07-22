"""
MpdMediaProvider — Adapter that implements the MediaProvider interface
by delegating to the existing PlayerMPD instance.

Does NOT override play_card(), which is inherited from the
MediaProvider base class.
"""

import logging
import os
from typing import Optional
import jukebox.plugs as plugs
from jukebox.mediaprovider import MediaProvider

logger = logging.getLogger('jb.mpd_provider')


class MpdMediaProvider(MediaProvider):
    """
    Adapter that implements the MediaProvider interface for MPD.

    Delegates all calls to the existing PlayerMPD instance.
    The PlayerMPD instance is injected after creation by the plugin's
    @initialize.

    Does NOT override play_card(). The base class
    MediaProvider.play_card() is inherited, which handles:
    - Global second-swipe detection (via Manager._last_played_folder)
    - Global second-swipe action (via Manager._second_swipe_action)
    - Global play_card_callbacks (via Manager)
    - Delegates to self.play_folder() on first swipe

    All methods are decorated with @plugs.tag so they are RPC-callable.
    """

    def __init__(self):
        super().__init__()
        self._player = None  # Injected by playermpd/__init__.py

    def initialize(self):
        """MPD connection is handled by PlayerMPD.__init__()."""
        pass

    def shutdown(self):
        if self._player:
            return self._player.exit()

    # --- Delegation to PlayerMPD ---
    # NOTE: play_card() is NOT overridden — inherited from base class

    @plugs.tag
    def play(self):
        self._player.play()

    @plugs.tag
    def stop(self):
        self._player.stop()

    @plugs.tag
    def next(self):
        self._player.next()

    @plugs.tag
    def prev(self):
        self._player.prev()

    @plugs.tag
    def play_folder(self, folder: str, recursive: bool = False):
        """
        Play folder or single file via MPD.

        Auto-detects file vs directory: if 'folder' resolves to a file
        path, routes internally to play_single(). Otherwise delegates
        to PlayerMPD.play_folder().
        """
        from . import get_music_library_path
        music_lib_path = get_music_library_path()
        full_path = os.path.join(music_lib_path, folder)

        if os.path.isfile(full_path):
            logger.debug(f"Detected file (not folder): {folder}")
            self._player.play_single(folder)
        else:
            self._player.play_folder(folder, recursive)

    @plugs.tag
    def play_single(self, song_url: str):
        self._player.play_single(song_url)

    @plugs.tag
    def play_album(self, albumartist: str, album: str):
        self._player.play_album(albumartist, album)

    @plugs.tag
    def clear_playlist(self):
        """Clear the playlist without starting playback."""
        with self._player.mpd_lock:
            self._player.mpd_client.clear()

    @plugs.tag
    def add_to_playlist(self, song_url: str):
        """Add a single track URL to the playlist without clearing."""
        with self._player.mpd_lock:
            self._player.mpd_client.addid(song_url)

    @plugs.tag
    def toggle(self):
        self._player.toggle()

    @plugs.tag
    def pause(self, state: int = 1):
        self._player.pause(state)

    @plugs.tag
    def seek(self, new_time: float):
        self._player.seek(new_time)

    @plugs.tag
    def rewind(self):
        self._player.rewind()

    @plugs.tag
    def status(self) -> dict:
        return self._player.playerstatus()

    @plugs.tag
    def get_current_song(self) -> Optional[dict]:
        return self._player.mpd_status

    @plugs.tag
    def playlistinfo(self) -> list:
        return self._player.playlistinfo()

    @plugs.tag
    def list_albums(self) -> list:
        return self._player.list_albums()

    @plugs.tag
    def get_folder_content(self, folder: str) -> list:
        return self._player.get_folder_content(folder)

    @plugs.tag
    def list_all_dirs(self) -> list:
        return self._player.list_all_dirs()

    @plugs.tag
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        return self._player.get_single_coverart(song_url)

    @plugs.tag
    def get_album_coverart(self, albumartist: str,
                           album: str) -> Optional[str]:
        return self._player.get_album_coverart(albumartist, album)

    @plugs.tag
    def update(self):
        return self._player.update()

    @plugs.tag
    def update_wait(self):
        return self._player.update_wait()

    @plugs.tag
    def get_player_type_and_version(self) -> str:
        return self._player.get_player_type_and_version()