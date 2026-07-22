"""
MediaProvider — Abstract Base Class for media source providers.

Usage:
    from jukebox.mediaprovider import MediaProvider, get_manager

    class MyProvider(MediaProvider):
        ...
"""

from abc import ABC, abstractmethod
from typing import Optional
import jukebox.plugs as plugs


class MediaProvider(ABC):
    """
    Abstract base class for all media source providers.

    Implementations: MpdMediaProvider (core), JellyfinMediaProvider, etc.
    Each provider is implemented as a plugin under src/jukebox/components/.
    Each provider registers itself with
    plugs.register(instance, package='<package>', name='provider').

    Second-swipe logic is implemented in play_card() and inherited by ALL
    providers. MpdMediaProvider does NOT override play_card() — it inherits
    the base implementation. The _last_played_folder is managed globally by
    the MediaProviderManager (not per-provider). The _second_swipe_action is
    resolved once from playermpd config and stored in the Manager.
    play_card_callbacks are centralized in the Manager and fired for all
    providers.

    play_card() is decorated with @plugs.tag in the base class. Since
    subclasses do NOT override it, the inherited method retains
    plugs_callable=True and is correctly dispatched by
    plugs.dereference(). All other abstract methods must be tagged with
    @plugs.tag in their concrete subclass implementations.
    """

    def __init__(self):
        pass

    # --- Lifecycle ---
    @abstractmethod
    def initialize(self):
        """Initialize the provider (connect, authenticate, etc.)"""
        pass

    @abstractmethod
    def shutdown(self):
        """Shutdown the provider gracefully"""
        pass

    # --- Second Swipe Logic (implemented in base class, inherited by all) ---
    @plugs.tag
    def play_card(self, folder: str, recursive: bool = False):
        """
        Play content triggered by RFID card.

        Second swipe detection is implemented here (inherited by ALL
        providers). Uses globally-shared _last_played_folder and
        _second_swipe_action from the MediaProviderManager. Fires
        centralized play_card_callbacks.

        MpdMediaProvider MUST NOT override this method.
        External providers (Jellyfin, SMB) inherit this method directly.

        The 'folder' parameter is provider-opaque. Each provider
        interprets it according to its own addressing scheme:
        - MPD: relative path within the local music library
        - Jellyfin: Jellyfin item ID
        - SMB: remote path on the share (e.g., "/Music/Album")
        """
        from jukebox.mediaprovider import get_manager
        mgr = get_manager()

        last_played = mgr.get_last_played_folder()
        is_second_swipe = (last_played == folder)

        mgr.set_last_played_folder(folder)
        mgr.persist_last_played_folder()

        swipe_action = mgr.get_second_swipe_action()

        state = (mgr.get_play_card_state_second() if is_second_swipe
                 else mgr.get_play_card_state_first())
        mgr.get_play_card_callbacks().run_callbacks(folder, state)

        if is_second_swipe and swipe_action:
            swipe_action()
        else:
            self.play_folder(folder, recursive)

    # --- Status ---
    @abstractmethod
    def status(self) -> dict:
        """Get current player status"""
        pass

    @abstractmethod
    def get_current_song(self) -> Optional[dict]:
        """Get currently playing song metadata"""
        pass

    # --- Playback Control ---
    @abstractmethod
    def play(self):
        """Resume playback"""
        pass

    @abstractmethod
    def stop(self):
        """Stop playback"""
        pass

    @abstractmethod
    def pause(self, state: int = 1):
        """Pause or resume (1=pause, 0=resume)"""
        pass

    @abstractmethod
    def toggle(self):
        """Toggle pause/play"""
        pass

    @abstractmethod
    def next(self):
        """Next track"""
        pass

    @abstractmethod
    def prev(self):
        """Previous track"""
        pass

    @abstractmethod
    def seek(self, new_time: float):
        """Seek to position in seconds"""
        pass

    @abstractmethod
    def rewind(self):
        """Restart current playlist from first track"""
        pass

    # --- Playlist & Content ---
    @abstractmethod
    def play_folder(self, folder: str, recursive: bool = False):
        """Play content from a folder/path identifier"""
        pass

    @abstractmethod
    def play_single(self, song_url: str):
        """Play a single track by its URL/identifier"""
        pass

    @abstractmethod
    def play_album(self, albumartist: str, album: str):
        """Play an album"""
        pass

    @abstractmethod
    def clear_playlist(self):
        """
        Clear the current playlist without starting playback.

        Used by external providers (Jellyfin, SMB) to clear the playlist
        once before adding multiple tracks via add_to_playlist().
        """
        pass

    @abstractmethod
    def add_to_playlist(self, song_url: str):
        """
        Add a single track to the current playlist without clearing or
        playing.

        Used by external providers to build a playlist incrementally.
        After adding all tracks, call play() to start playback.
        """
        pass

    @abstractmethod
    def playlistinfo(self) -> list:
        """Get current playlist"""
        pass

    @abstractmethod
    def list_albums(self) -> list:
        """List all available albums"""
        pass

    @abstractmethod
    def get_folder_content(self, folder: str) -> list:
        """List content of a folder/directory"""
        pass

    @abstractmethod
    def list_all_dirs(self) -> list:
        """List all top-level directories/collections"""
        pass

    # --- Cover Art ---
    @abstractmethod
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        """Get cover art for a single track. Returns filename or URL."""
        pass

    @abstractmethod
    def get_album_coverart(self, albumartist: str,
                           album: str) -> Optional[str]:
        """Get cover art for an album"""
        pass

    # --- Library Management ---
    @abstractmethod
    def update(self):
        """Trigger library update"""
        pass

    @abstractmethod
    def update_wait(self):
        """Trigger library update and wait for completion"""
        pass

    # --- Provider Info ---
    @abstractmethod
    def get_player_type_and_version(self) -> str:
        """Get provider identifier and version string"""
        pass


__all__ = ['MediaProvider', 'get_manager']


# Import manager's get_manager at bottom to provide it via the package
from jukebox.mediaprovider.manager import get_manager  # noqa: E402, F401