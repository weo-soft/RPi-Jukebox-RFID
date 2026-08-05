import logging

import components.player
import jukebox.cfghandler
import jukebox.plugs as plugs
import misc

from .backends.mpd import PlayerMPD
from .coordinator import PlayerCoordinator


logger = logging.getLogger('jb.player')
cfg = jukebox.cfghandler.get_handler('jukebox')


def initialize_mpd_player(plugin_module_name: str) -> PlayerCoordinator:
    """Create the coordinator with MPD as its sole backend and register it."""
    player_ctrl = PlayerCoordinator(components.player.play_card_callbacks)
    player_ctrl.register_backend('mpd', PlayerMPD())
    plugs.register(
        player_ctrl,
        name='ctrl',
        package=plugs.loaded_as(plugin_module_name),
    )

    # --- MediaProvider registration (feature-branch integration) ---
    _register_media_provider(player_ctrl)

    if cfg.setndefault('playermpd', 'library', 'update_on_startup', value=True):
        player_ctrl.update()

    check_user_rights = cfg.setndefault(
        'playermpd', 'library', 'check_user_rights', value=True
    )
    if check_user_rights is True:
        music_library_path = components.player.get_music_library_path()
        if music_library_path is not None:
            logger.info(f"Change user rights for {music_library_path}")
            misc.recursive_chmod(music_library_path, mode_files=0o666, mode_dirs=0o777)

    return player_ctrl


def _register_media_provider(player_ctrl: PlayerCoordinator) -> None:
    """Register MPD as the default MediaProvider with the MediaProviderManager.

    This is called automatically by :func:`initialize_mpd_player` so that the
    mediaprovider architecture is available whether the player plugin is loaded
    under its canonical name (``player.plugin``) or through the compatibility
    shim (``playermpd``).
    """
    from jukebox.mediaprovider import get_manager

    # Access the underlying PlayerMPD backend so the mediaprovider adapter can
    # delegate to real MPD fields (mpd_lock, mpd_client, etc.).
    mpd_backend = player_ctrl.get_backend('mpd')

    mgr = get_manager()

    # Inject the shared callback handler, second-swipe action, and persistence
    # callback into the MediaProviderManager.
    # Use the canonical module-level callback handler (the same instance passed
    # to the PlayerCoordinator), so that components registering on
    # components.player.play_card_callbacks (e.g. sync_rfidcards) receive
    # callbacks from both the coordinator and the mediaprovider paths.
    mgr.set_play_card_callbacks(components.player.play_card_callbacks)
    mgr.set_second_swipe_action(mpd_backend.second_swipe_action)

    def _persist_to_music_player_status(folder: str):
        if 'player_status' not in mpd_backend.music_player_status:
            mpd_backend.music_player_status['player_status'] = {}
        mpd_backend.music_player_status['player_status']['last_played_folder'] = folder
        mpd_backend.music_player_status.save_to_json()
    mgr.set_persist_callback(_persist_to_music_player_status)

    # Restore persisted _last_played_folder into the Manager
    restored = mpd_backend.music_player_status.get(
        'player_status', {}
    ).get('last_played_folder', '')
    mgr.set_last_played_folder(restored)

    # Register MPD as the default MediaProvider.
    # The MpdMediaProvider adapter delegates to the underlying PlayerMPD backend.
    from .mpd_provider import MpdMediaProvider
    mpd_provider = MpdMediaProvider()
    mpd_provider._player = mpd_backend
    mpd_provider.initialize()
    mgr.register_provider('mpd', mpd_provider)
    mgr.set_default('mpd')
    plugs.register(mpd_provider, package='player', name='provider')