"""Jellyfin player backend registration and configuration."""

import logging

import jukebox.cfghandler

from .jellyfin_api_client import DEFAULT_TIMEOUT, JellyfinApiClient
from .jellyfin_backend import JellyfinBackend


logger = logging.getLogger('jb.player.jellyfin')
_jellyfin_backend = None


def configure_jellyfin(player_ctrl):
    """Create the Jellyfin backend and register it when enabled.

    Registration is a no-op unless ``players.jellyfin.enabled`` is set.
    Authentication is lazy: neither the API key nor the login credentials
    are validated at startup, only on the first catalog or playback request.
    """
    global _jellyfin_backend
    cfg = jukebox.cfghandler.get_handler('jukebox')
    enabled = cfg.setndefault('players', 'jellyfin', 'enabled', value=False)
    host = cfg.setndefault('players', 'jellyfin', 'host', value='')
    api_key = cfg.setndefault('players', 'jellyfin', 'api_key', value='')
    username = cfg.setndefault('players', 'jellyfin', 'username', value='')
    password = cfg.setndefault('players', 'jellyfin', 'password', value='')
    cache_ttl = float(cfg.setndefault(
        'players', 'jellyfin', 'catalog_cache_ttl', value=300) or 300)
    request_timeout = float(cfg.setndefault(
        'players', 'jellyfin', 'request_timeout',
        value=DEFAULT_TIMEOUT) or DEFAULT_TIMEOUT)
    if not enabled:
        return None
    if not host:
        logger.error(
            "Jellyfin enabled but host missing; backend not registered")
        return None
    if not api_key and not (username and password):
        logger.error(
            "Jellyfin enabled but neither api_key nor username/password "
            "set; backend not registered")
        return None
    if username or password:
        api = JellyfinApiClient(
            host, username=username, password=password,
            timeout=request_timeout)
    else:
        api = JellyfinApiClient(host, api_key, timeout=request_timeout)
    backend = JellyfinBackend(api, player_ctrl._get_backend('mpd'), cache_ttl)
    player_ctrl.register_backend('jellyfin', backend)
    _jellyfin_backend = backend
    logger.info("Jellyfin backend registered")
    return backend
