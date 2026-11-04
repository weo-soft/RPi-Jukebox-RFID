# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder
"""
Assignable actions for the MCP23017 button settings.

The Web App offers a fixed catalog instead of raw RPC commands: every entry
maps to one of the pre-defined RPC aliases, so the settings page cannot build
arbitrary calls.
"""

from typing import Any, Dict, List, Optional

from .config import ButtonConfig

ACTION_CATALOG: List[Dict[str, Any]] = [
    {
        'id': 'play_pause',
        'label': 'Play/Pause',
        'alias': 'toggle',
        'type': 'momentary',
    },
    {
        'id': 'next',
        'label': 'Next title',
        'alias': 'next_song',
        'type': 'momentary',
    },
    {
        'id': 'previous',
        'label': 'Previous title',
        'alias': 'prev_song',
        'type': 'momentary',
    },
    {
        'id': 'volume_up',
        'label': 'Volume up',
        'alias': 'change_volume',
        'args': [2],
        'type': 'hold_repeat',
        'hold_ms': 500,
    },
    {
        'id': 'volume_down',
        'label': 'Volume down',
        'alias': 'change_volume',
        'args': [-2],
        'type': 'hold_repeat',
        'hold_ms': 500,
    },
    {
        'id': 'shutdown',
        'label': 'Shut down',
        'alias': 'shutdown',
        'type': 'momentary',
        'danger': True,
    },
    {
        'id': 'reboot',
        'label': 'Reboot',
        'alias': 'reboot',
        'type': 'momentary',
        'danger': True,
    },
    {
        'id': 'say_ip',
        'label': 'Say IP address',
        'alias': 'say_my_ip',
        'type': 'momentary',
    },
]


def action_entry(action_id: str) -> Optional[Dict[str, Any]]:
    """Return a copy of a catalog entry or None for an unknown id."""
    for entry in ACTION_CATALOG:
        if entry['id'] == action_id:
            return dict(entry)
    return None


def action_ids() -> List[str]:
    return [entry['id'] for entry in ACTION_CATALOG]


def catalog_entries() -> List[Dict[str, Any]]:
    """Return copies of all catalog entries for the settings API."""
    return [dict(entry) for entry in ACTION_CATALOG]


def action_id_for(button: ButtonConfig) -> Optional[str]:
    """Map a simple configured button back to its catalog id.

    Only buttons with one alias action and the catalog's button type are
    mapped; everything else (long press, short/long, custom RPC) is reported
    as an advanced definition that the settings page does not edit.
    """
    if button.type not in ('momentary', 'hold_repeat'):
        return None
    if not button.active_low or button.pull_up != 'internal':
        return None
    spec = button.actions.get('on_press')
    if spec is None or spec.source != 'alias':
        return None
    for entry in ACTION_CATALOG:
        if entry['alias'] != spec.alias or entry['type'] != button.type:
            continue
        if list(spec.args or []) != list(entry.get('args') or []):
            continue
        return entry['id']
    return None
