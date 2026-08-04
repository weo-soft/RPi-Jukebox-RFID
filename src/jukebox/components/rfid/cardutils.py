"""
Common card decoding functions — unified provider-based routing.

All playback cards use the unified format:
    provider: <provider_name>
    value: <provider-opaque identifier>
    recursive: false  (optional)

Legacy alias-based MPD cards (alias: play_card, alias: play_folder)
are auto-detected and transparently converted to provider: mpd.

Command cards (shutdown, GPIO, etc.) still use the alias format.
"""

import logging
from typing import (List, Mapping)
import jukebox.utils as utils
import jukebox.cfghandler

log = logging.getLogger('jb.cardutils')
cfg_cards = jukebox.cfghandler.get_handler('cards')


def _resolve_provider(cfg_rpc_cmd: Mapping, logger: logging.Logger):
    """
    Resolve provider, value, recursive from card config.

    Priority:
    1. Explicit provider: field → use directly
    2. Legacy alias: play_card / play_folder → auto-detect as provider=mpd
    3. Everything else → return (None, '', False, False) (not a playback card)

    :return: Tuple of (provider_name, value, recursive, is_legacy)
    """
    if 'provider' in cfg_rpc_cmd:
        provider_name = cfg_rpc_cmd['provider']
        value = cfg_rpc_cmd.get('value', '')
        recursive = cfg_rpc_cmd.get('recursive', False)
        if not provider_name:
            logger.error(
                "Card entry has 'provider:' field but no provider name"
            )
            return (None, '', False, False)
        if not value:
            logger.error(
                f"Card entry for provider '{provider_name}' "
                f"has no 'value' field"
            )
            return (None, '', False, False)
        return (provider_name, value, recursive, False)

    alias = cfg_rpc_cmd.get('alias')
    if alias in ('play_card', 'play_folder'):
        args = cfg_rpc_cmd.get('args', [])
        value = args[0] if args else ''
        recursive = len(args) > 1 and args[1] is True
        logger.debug(
            f"Auto-detected legacy MPD card: alias={alias}, "
            f"value={value}, recursive={recursive}"
        )
        return ('mpd', value, recursive, True)

    return (None, '', False, False)


def decode_card_command(cfg_rpc_cmd: Mapping, logger: logging.Logger = log):
    """
    Decode a card command with unified provider-based routing.

    All playback cards (explicit provider: or legacy
    alias: play_card/play_folder) are routed through the single path:
    {provider}.provider.play_card(value).

    Command cards (shutdown, GPIO, etc.) fall through to alias-based
    routing.

    Unified format (recommended):
        rfid_card_01:
          provider: mpd
          value: "AlbumXYZ"

        rfid_card_02:
          provider: jellyfin
          value: "folder_id_456"

        rfid_card_03:
          provider: smb
          value: "music:/Rock/AlbumXYZ"
          recursive: true

    Legacy format (auto-detected, no migration needed):
        rfid_card_01:
          alias: play_card
          args: ["AlbumXYZ"]
    """
    if cfg_rpc_cmd is None:
        return None

    provider_name, value, recursive, is_legacy = _resolve_provider(
        cfg_rpc_cmd, logger
    )

    if provider_name is not None:
        try:
            from jukebox.mediaprovider import get_manager
            get_manager().resolve(provider_name)
        except (KeyError, RuntimeError) as e:
            logger.error(
                f"Provider '{provider_name}' not available: {e}"
            )
            return None

        kwargs = {}
        if recursive:
            kwargs['recursive'] = True

        action = {
            'package': provider_name,
            'plugin': 'provider',
            'method': 'play_card',
            'args': (value,),
            'kwargs': kwargs,
        }

        if 'ignore_same_id_delay' in cfg_rpc_cmd:
            action['ignore_same_id_delay'] = \
                cfg_rpc_cmd['ignore_same_id_delay']
        if 'ignore_card_removal_action' in cfg_rpc_cmd:
            action['ignore_card_removal_action'] = \
                cfg_rpc_cmd['ignore_card_removal_action']

        return action

    action = utils.decode_rpc_command(cfg_rpc_cmd, logger)
    if 'ignore_same_id_delay' in cfg_rpc_cmd:
        action['ignore_same_id_delay'] = \
            cfg_rpc_cmd['ignore_same_id_delay']
    if 'ignore_card_removal_action' in cfg_rpc_cmd:
        action['ignore_card_removal_action'] = \
            cfg_rpc_cmd['ignore_card_removal_action']
    return action


def card_command_to_str(cfg_rpc_cmd: Mapping, long=False) -> List[str]:
    """Returns a list of strings with [card_action, ignore_same_id_delay,
    ignore_card_removal_action]

    The last two parameters are only present, if *long* is True and if
    they are present in the cfg_rpc_cmd"""
    action = decode_card_command(cfg_rpc_cmd)
    if action is None:
        return ["Error: Could not decode card command"]

    provider_name, _, _, _ = _resolve_provider(cfg_rpc_cmd, log)
    if provider_name is not None:
        value = cfg_rpc_cmd.get(
            'value',
            cfg_rpc_cmd.get('args', [''])[0]
        )
        readable = [
            f"{provider_name}.provider.play_card('{value}')"
        ]
        if long:
            if 'ignore_same_id_delay' in action.keys():
                readable.append(
                    f"ignore_same_id_delay: "
                    f"{action['ignore_same_id_delay']}"
                )
            if 'ignore_card_removal_action' in action.keys():
                readable.append(
                    f"ignore_card_removal_action: "
                    f"{action['ignore_card_removal_action']}"
                )
        return readable

    readable = [utils.rpc_call_to_str(action)]
    if long:
        if 'ignore_same_id_delay' in action.keys():
            readable.append(
                f"ignore_same_id_delay: "
                f"{action['ignore_same_id_delay']}"
            )
        if 'ignore_card_removal_action' in action.keys():
            readable.append(
                f"ignore_card_removal_action: "
                f"{action['ignore_card_removal_action']}"
            )
    return readable


def card_to_str(card_id: str, long=False) -> List[str]:
    """Returns a list of strings from card entry command in the format
    of :func:`card_command_to_str`"""
    readable = ["Error: Card ID not found in database!"]
    if card_id in cfg_cards:
        readable = card_command_to_str(
            cfg_cards.getn(card_id, default=None), long
        )
    return readable
