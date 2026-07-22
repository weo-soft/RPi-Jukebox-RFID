"""
Jellyfin Media Provider Plugin

Provides Jellyfin media server integration for the Phoniebox.

Second-swipe detection is inherited from MediaProvider.play_card().
JellyfinMediaProvider does NOT override play_card(). The global
second_swipe_action comes from playermpd config (via the Manager)
and play_card_callbacks are fired centrally by the Manager.
"""

import logging
import jukebox.plugs as plugs
import jukebox.cfghandler

logger = logging.getLogger('jb.jellyfin')
cfg = jukebox.cfghandler.get_handler('jukebox')

jellyfin_provider_instance = None


def initialize():
    """
    Initialize Jellyfin provider.

    Requires MPD to be registered as a MediaProvider (audio backend).
    If MPD is not available, the plugin logs an error and skips
    initialization.

    Reads configuration from jukebox.yaml:
      jellyfin.host
      jellyfin.api_key

    play_card() is inherited from the base class — no explicit
    implementation needed. The second-swipe action is provided by
    the Manager (from playermpd config).
    """
    global jellyfin_provider_instance

    from jukebox.mediaprovider import get_manager
    try:
        mpd_provider = get_manager().get_provider('mpd')
    except KeyError:
        logger.error(
            "MPD provider not found. "
            "Jellyfin requires MPD as audio backend. Aborting."
        )
        return

    from .jellyfin_provider import JellyfinMediaProvider

    try:
        jellyfin_provider_instance = JellyfinMediaProvider(
            mpd_backend=mpd_provider,
        )
        jellyfin_provider_instance.initialize()
    except (ValueError, ConnectionError) as e:
        logger.error(f"Jellyfin initialization failed: {e}")
        jellyfin_provider_instance = None
        return

    get_manager().register_provider(
        'jellyfin', jellyfin_provider_instance
    )

    # Register under the 'jellyfin' package as 'provider'
    plugs.register(
        jellyfin_provider_instance,
        package='jellyfin',
        name='provider',
    )

    logger.info("Jellyfin Media Provider initialized and registered")


def finalize():
    """Publish initial state after all plugins are loaded."""
    pass


def atexit(**kwargs):
    """Shutdown Jellyfin provider gracefully."""
    global jellyfin_provider_instance
    if jellyfin_provider_instance is not None:
        jellyfin_provider_instance.shutdown()
        jellyfin_provider_instance = None
        logger.info("Jellyfin Media Provider shut down")


# Register lifecycle hooks with the plug system.
# Wrapped in try/except so tests can import this module directly
# without the jellyfin package being registered in _PACKAGE_MAP.
try:
    initialize = plugs.initialize(initialize)
    finalize = plugs.finalize(finalize)
    atexit = plugs.atexit(atexit)
except KeyError:
    # Module was imported outside the plug system (e.g. during
    # pytest collection). The real lifecycle registration happens
    # when plugs.load_all_unnamed() loads this module, which sets
    # _PACKAGE_MAP before importing.
    logger.debug("jellyfin __init__ imported outside plug system")
