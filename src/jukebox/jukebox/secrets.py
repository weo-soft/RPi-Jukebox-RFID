"""
Consumer-agnostic secrets management for Phoniebox future3.

Provides a generic interface for storing and retrieving credentials
(API keys, passwords, tokens). Usable by any plugin, the installer,
and the WebUI (via RPC).
"""

import os
import threading
import logging
from pathlib import Path
from typing import Optional, List

from ruamel.yaml import YAML

import jukebox.cfghandler

logger = logging.getLogger('jb.secrets')

_write_lock = threading.Lock()
_cache: dict = {}
_cache_loaded: bool = False


def _get_secrets_path() -> Path:
    """Resolve the secrets.yaml path from jukebox configuration.

    Uses the jukebox.yaml config key 'secrets.file' (default:
    ../../shared/settings/secrets.yaml relative to the jukebox CWD).
    """
    cfg = jukebox.cfghandler.get_handler('jukebox')
    path_str = cfg.setndefault('secrets', 'file',
                               value='../../shared/settings/secrets.yaml')
    return Path(path_str)


def _load_cache() -> dict:
    global _cache, _cache_loaded
    if _cache_loaded:
        return _cache
    secrets_path = _get_secrets_path()
    if secrets_path.is_file():
        try:
            yaml = YAML(typ='safe')
            with open(secrets_path, 'r') as f:
                _cache = yaml.load(f) or {}
        except Exception as e:
            logger.error(f"Failed to load secrets.yaml: {e}")
            _cache = {}
    else:
        _cache = {}
    _cache_loaded = True
    return _cache


def _save_cache() -> None:
    global _cache
    secrets_path = _get_secrets_path()
    with _write_lock:
        secrets_path.parent.mkdir(parents=True, exist_ok=True)
        yaml = YAML(typ='safe')
        try:
            with open(secrets_path, 'w') as f:
                yaml.dump(_cache, f)
            os.chmod(secrets_path, 0o600)
        except Exception as e:
            logger.error(f"Failed to write secrets.yaml: {e}")
            raise


def _reload_cache() -> None:
    global _cache, _cache_loaded
    _cache_loaded = False
    _cache = {}
    _load_cache()


def store(namespace: str, key: str, value: str) -> None:
    """Store a secret value.

    :param namespace: Top-level category (e.g., 'jellyfin', 'mqtt', 'smb')
    :param key: Secret key name within the namespace
    :param value: Secret value to store
    """
    _load_cache()
    if namespace not in _cache:
        _cache[namespace] = {}
    _cache[namespace][key] = value
    _save_cache()
    logger.info(f"Secret stored: '{namespace}.{key}'")


def retrieve(namespace: str, key: str,
             env_var: Optional[str] = None,
             default: Optional[str] = None) -> Optional[str]:
    """Retrieve a secret value with priority: env > secrets.yaml > default.

    :param namespace: Top-level category (e.g., 'jellyfin', 'mqtt', 'smb')
    :param key: Secret key name within the namespace
    :param env_var: Optional environment variable name to check first
    :param default: Default value if secret is not found anywhere
    :return: The secret value, or default if not found
    """
    if env_var and env_var in os.environ and os.environ[env_var]:
        return os.environ[env_var]

    _load_cache()
    # Support dotted namespaces (e.g. 'smb.shares.music')
    ns_data = _cache
    for part in namespace.split('.'):
        if isinstance(ns_data, dict):
            ns_data = ns_data.get(part, {})
        else:
            ns_data = {}
    if isinstance(ns_data, dict) and key in ns_data:
        return ns_data[key]

    return default


def delete(namespace: str, key: str) -> bool:
    """Delete a secret from the backing store.

    :param namespace: Top-level category (e.g., 'jellyfin', 'mqtt', 'smb')
    :param key: Secret key name within the namespace
    :return: True if the key existed and was deleted, False otherwise
    """
    _load_cache()
    parts = namespace.split('.')
    # Walk all parts to reach the leaf dict where the key lives
    ns_data = _cache
    parent = _cache
    for i, part in enumerate(parts):
        parent = ns_data
        if isinstance(ns_data, dict):
            ns_data = ns_data.get(part, {})
        else:
            return False
    # Now ns_data is the dict containing the key
    if not isinstance(ns_data, dict):
        return False
    if key in ns_data:
        del ns_data[key]
        if not ns_data:
            # Leaf dict is empty — remove it from parent
            leaf_name = parts[-1]
            if parent is not ns_data and isinstance(parent, dict) and leaf_name in parent:
                del parent[leaf_name]
        _save_cache()
        logger.info(f"Secret deleted: '{namespace}.{key}'")
        return True
    return False


def list_keys(namespace: str) -> List[str]:
    """List all key names within a namespace (NO values exposed!).

    :param namespace: Top-level category (e.g., 'jellyfin', 'mqtt', 'smb')
    :return: Sorted list of key names
    """
    _load_cache()
    return sorted(_cache.get(namespace, {}).keys())