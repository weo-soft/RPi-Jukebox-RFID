# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder
"""
Persist button assignments in the MCP23017 configuration file.

The settings page edits one pin at a time. The file is loaded round-trip so
comments and all other buttons survive a change; the write is atomic, so a
crash cannot leave a half-written configuration behind.
"""

import logging
import os
import stat
from typing import Any, Dict, Optional

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap, CommentedSeq

from .config import ConfigError, parse_pin, pin_name

logger = logging.getLogger('jb.mcp23017')


def assign_button(path: str, pin: int, action: Dict[str, Any],
                  bus: int, address: int) -> None:
    """Assign a catalog action to a pin, replacing an existing assignment."""
    pin = parse_pin(pin)
    data = _load(path, bus, address)
    buttons = _buttons(data)
    name = _name_for_pin(buttons, pin) or _unique_name(buttons, action['id'])
    buttons[name] = _button_entry(pin, action)
    _write(path, data)
    logger.info("Assigned MCP23017 pin %s to action '%s'", pin_name(pin), action['id'])


def clear_button(path: str, pin: int, bus: int, address: int) -> None:
    """Remove the assignment of a pin, if any."""
    pin = parse_pin(pin)
    data = _load(path, bus, address)
    buttons = _buttons(data)
    name = _name_for_pin(buttons, pin)
    if name is None:
        return
    del buttons[name]
    _write(path, data)
    logger.info('Removed the MCP23017 assignment of pin %s', pin_name(pin))


def _button_entry(pin: int, action: Dict[str, Any]) -> CommentedMap:
    entry = CommentedMap()
    entry['pin'] = pin_name(pin)
    entry['type'] = action['type']
    entry['active_low'] = True
    entry['pull_up'] = 'internal'
    entry['debounce_ms'] = 30
    if action['type'] == 'hold_repeat':
        entry['hold_ms'] = action.get('hold_ms', 500)
    spec = CommentedMap()
    spec['alias'] = action['alias']
    args = action.get('args')
    if args:
        sequence = CommentedSeq(args)
        sequence.fa.set_flow_style()
        spec['args'] = sequence
    actions = CommentedMap()
    actions['on_press'] = spec
    entry['actions'] = actions
    return entry


def _load(path: str, bus: int, address: int) -> CommentedMap:
    yaml = YAML(typ='rt')
    if os.path.isfile(path):
        with open(path, encoding='utf-8') as stream:
            data = yaml.load(stream)
        if data is None:
            data = CommentedMap()
    else:
        data = CommentedMap()
        data['bus'] = bus
        data['address'] = address
        data['chip'] = 'auto'
        data['poll_interval_ms'] = 25
    if 'buttons' not in data or data['buttons'] is None:
        data['buttons'] = CommentedMap()
    return data


def _buttons(data: CommentedMap) -> CommentedMap:
    buttons = data['buttons']
    if not isinstance(buttons, CommentedMap):
        buttons = CommentedMap(buttons or {})
        data['buttons'] = buttons
    return buttons


def _name_for_pin(buttons: CommentedMap, pin: int) -> Optional[str]:
    for name, entry in buttons.items():
        if not isinstance(entry, dict):
            continue
        try:
            entry_pin = parse_pin(entry.get('pin'))
        except ConfigError:
            continue
        if entry_pin == pin:
            return str(name)
    return None


def _unique_name(buttons: CommentedMap, base: str) -> str:
    name = base
    counter = 2
    while name in buttons:
        name = f'{base}_{counter}'
        counter += 1
    return name


def _write(path: str, data: CommentedMap) -> None:
    yaml = YAML(typ='rt')
    directory = os.path.dirname(os.path.abspath(path))
    temporary = os.path.join(directory, f'.{os.path.basename(path)}.tmp')
    with open(temporary, 'w', encoding='utf-8') as stream:
        yaml.dump(data, stream)
    if os.path.isfile(path):
        mode = stat.S_IMODE(os.stat(path).st_mode)
        os.chmod(temporary, mode)
    os.replace(temporary, path)
