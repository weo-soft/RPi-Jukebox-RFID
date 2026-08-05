"""
MediaProviderManager — Singleton for provider registration and resolution.

Centralizes:
- Provider registration and resolution
- Global _last_played_folder (persisted via music_player_status.json)
- Global _second_swipe_action (injected from PlayerMPD)
- Central play_card_callbacks instance (injected from playermpd, shared by all)

Usage:
    from jukebox.mediaprovider import get_manager

    manager = get_manager()
    manager.register_provider('mpd', mpd_provider)
    manager.set_default('mpd')
    manager.set_second_swipe_action(player_ctrl.second_swipe_action)
    manager.set_play_card_callbacks(play_card_callbacks)

    provider = get_manager().resolve('jellyfin')
    provider = get_manager().resolve()  # Default provider (MPD)
    get_manager().list_providers()  # ['mpd', 'jellyfin']
"""

import logging
from typing import Optional, Callable

logger = logging.getLogger('jb.mediaprovider.manager')


class MediaProviderManager:
    """
    Manages multiple media providers simultaneously.

    - Providers register themselves during plugin @initialize.
    - MPD is always the default provider (audio backend).
    - Supports routing: each RFID card can specify a different provider.
    - Centralizes _last_played_folder and _second_swipe_action globally.
    - Centralizes play_card_callbacks (injected from playermpd after
      creation).
    """

    def __init__(self):
        self._providers: dict = {}
        self._default_provider: Optional[str] = None

        # Global second-swipe attributes (injected from PlayerMPD)
        self._last_played_folder: str = ''
        self._second_swipe_action: Optional[Callable] = None

        # Persist callback (injected from playermpd)
        self._persist_callback: Optional[Callable[[str], None]] = None

        # Central play_card_callbacks (injected from playermpd)
        self._play_card_callbacks = None
        self._play_card_state_first = None
        self._play_card_state_second = None

    # --- Provider Registration ---

    def register_provider(self, name: str, provider):
        """Register a media provider under a given name"""
        if name in self._providers:
            logger.warning(
                f"Provider '{name}' already registered. Overwriting."
            )
        self._providers[name] = provider
        logger.info(f"Provider '{name}' registered")

    def set_default(self, name: str):
        """
        Set the default provider (for RPC fallback).

        Raises KeyError if not registered.
        MPD is always the default provider.
        """
        if name not in self._providers:
            raise KeyError(
                f"Provider '{name}' not registered. "
                f"Available: {list(self._providers.keys())}"
            )
        self._default_provider = name
        logger.info(f"Default provider set to '{name}'")

    def get_default(self) -> Optional[str]:
        """Get the name of the default provider."""
        return self._default_provider

    def resolve(self, provider_name: str = None):
        """
        Resolve a provider by name. Falls back to default if name is None.

        Raises RuntimeError if no provider is found.
        """
        if provider_name is None:
            provider_name = self._default_provider
        if provider_name is None:
            raise RuntimeError(
                "No media provider configured and no default set"
            )
        if provider_name not in self._providers:
            raise KeyError(
                f"Provider '{provider_name}' not registered. "
                f"Available: {list(self._providers.keys())}"
            )
        return self._providers[provider_name]

    def get_provider(self, name: str):
        """Get a provider by name. Raises KeyError if not found."""
        return self.resolve(name)

    def list_providers(self) -> list:
        """List all registered provider names."""
        return list(self._providers.keys())

    # --- Global Second-Swipe Attributes ---

    def get_last_played_folder(self) -> str:
        """Get the globally-persisted last played folder value."""
        return self._last_played_folder

    def set_last_played_folder(self, folder: str):
        """Set the globally-persisted last played folder value."""
        self._last_played_folder = folder

    def set_persist_callback(self, callback: Callable[[str], None]):
        """
        Set a callback for persisting _last_played_folder.

        Injected by playermpd/__init__.py alongside second_swipe_action.
        The callback updates the music_player_status dict and calls
        save_to_json().
        """
        self._persist_callback = callback

    def persist_last_played_folder(self):
        """
        Persist the current _last_played_folder using the injected
        callback. Falls back gracefully if callback hasn't been set.
        """
        if self._persist_callback is not None:
            self._persist_callback(self._last_played_folder)
        else:
            logger.debug(
                "Persist callback not yet injected. Skipping persist."
            )

    def set_second_swipe_action(self, action: Optional[Callable]):
        """
        Set the globally-shared second swipe action.

        Called by playermpd/__init__.py's @initialize with the
        already-resolved action from PlayerMPD.
        """
        self._second_swipe_action = action

    def get_second_swipe_action(self) -> Optional[Callable]:
        """Get the globally-shared second swipe action callable."""
        return self._second_swipe_action

    # --- Central Callbacks ---

    def set_play_card_callbacks(self, callbacks):
        """
        Set the globally-shared PlayContentCallbacks instance.

        Called by playermpd/__init__.py after the instance is created
        (with MPD lock context). All providers access this via
        get_play_card_callbacks().
        """
        from jukebox.callingback import PlayCardState
        self._play_card_callbacks = callbacks
        self._play_card_state_first = PlayCardState.firstSwipe
        self._play_card_state_second = PlayCardState.secondSwipe

    def get_play_card_callbacks(self):
        """Get the globally-shared PlayContentCallbacks instance."""
        if self._play_card_callbacks is None:
            raise RuntimeError(
                "play_card_callbacks not yet injected. "
                "PlayerMPD must be initialized first."
            )
        return self._play_card_callbacks

    def get_play_card_state_first(self):
        """Get PlayCardState.firstSwipe enum value."""
        if self._play_card_state_first is None:
            raise RuntimeError("play_card_callbacks not yet injected.")
        return self._play_card_state_first

    def get_play_card_state_second(self):
        """Get PlayCardState.secondSwipe enum value."""
        if self._play_card_state_second is None:
            raise RuntimeError("play_card_callbacks not yet injected.")
        return self._play_card_state_second


# Module-level singleton
_manager_instance: Optional[MediaProviderManager] = None


def get_manager() -> MediaProviderManager:
    """Factory function for the MediaProviderManager singleton."""
    global _manager_instance
    if _manager_instance is None:
        _manager_instance = MediaProviderManager()
    return _manager_instance
