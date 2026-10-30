# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder
"""
Configuration parsing and validation for the MCP23017 button plugin.

The YAML file holds the device settings next to the per-button entries.
A malformed button is reported through :attr:`ButtonConfig.error` and skipped
by the runtime; only file-wide problems raise :class:`ConfigError`.
"""

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional

from .actions import ActionError, ActionSpec, ResolvedAction, parse_action

logger = logging.getLogger('jb.mcp23017')

BUTTON_TYPES = ('momentary', 'long_press', 'short_long_press', 'hold_repeat')
ACTION_KEYS = {
    'momentary': ('on_press',),
    'long_press': ('on_long_press',),
    'short_long_press': ('on_short_press', 'on_long_press'),
    'hold_repeat': ('on_press',),
}
PULL_UP_MODES = ('internal', 'external', 'none')
BUTTON_KEYS = frozenset({
    'pin',
    'type',
    'active_low',
    'pull_up',
    'debounce_ms',
    'hold_ms',
    'actions',
})
_PIN_PATTERN = re.compile(r'^GP([AB])([0-7])$')


class ConfigError(ValueError):
    """Raised for configuration errors that affect the whole file or a button."""


@dataclass
class ButtonConfig:
    """One configured button."""

    name: str
    pin: int = -1
    type: str = ''
    active_low: bool = True
    pull_up: str = 'internal'
    debounce_ms: int = 0
    hold_ms: Optional[int] = None
    actions: Dict[str, ActionSpec] = field(default_factory=dict)
    resolved: Dict[str, ResolvedAction] = field(default_factory=dict)
    valid: bool = False
    error: Optional[str] = None

    @property
    def debounce_seconds(self) -> float:
        return self.debounce_ms / 1000.0

    @property
    def hold_seconds(self) -> float:
        return (self.hold_ms or 0) / 1000.0


@dataclass
class McpConfig:
    """Validated content of the MCP23017 configuration file."""

    bus: int
    address: int
    chip: Optional[int]
    poll_interval_ms: int
    buttons: List[ButtonConfig]

    @property
    def address_hex(self) -> str:
        return f'0x{self.address:02x}'

    @property
    def poll_interval_seconds(self) -> float:
        return self.poll_interval_ms / 1000.0

    @property
    def valid_buttons(self) -> List[ButtonConfig]:
        return [button for button in self.buttons if button.valid]

    @property
    def gppu_mask(self) -> int:
        mask = 0
        for button in self.buttons:
            if button.valid and button.pull_up == 'internal':
                mask |= 1 << button.pin
        return mask


def pin_name(line: int) -> str:
    """Return the GPA/GPB name of a port expander line."""
    if 0 <= line <= 7:
        return f'GPA{line}'
    if 8 <= line <= 15:
        return f'GPB{line - 8}'
    return str(line)


def parse_pin(value: Any) -> int:
    """Convert a configured pin name or number into a line number 0-15."""
    if isinstance(value, bool):
        raise ConfigError(f"invalid pin: '{value}'")
    if isinstance(value, int):
        line = value
    elif isinstance(value, str):
        text = value.strip().upper()
        match = _PIN_PATTERN.match(text)
        if match:
            offset = 0 if match.group(1) == 'A' else 8
            line = offset + int(match.group(2))
        elif text.isdigit():
            line = int(text)
        else:
            raise ConfigError(f"invalid pin: '{value}'")
    else:
        raise ConfigError(f"invalid pin: '{value}'")
    if not 0 <= line <= 15:
        raise ConfigError(f"pin '{value}' is outside the range GPA0-GPB7")
    return line


def parse_config(cfg: Any) -> McpConfig:
    """Validate a loaded configuration handler and return the device settings."""
    bus = _int_value(cfg.getn('bus', default=None), 'bus', 0, 6)
    address = _int_value(cfg.getn('address', default=None), 'address', 0x20, 0x27)
    chip = _chip_value(cfg.getn('chip', default='auto'))
    poll_interval_ms = _int_value(cfg.getn('poll_interval_ms', default=25),
                                  'poll_interval_ms', 10, 1000)
    raw_buttons = cfg.getn('buttons', default=None)
    if not isinstance(raw_buttons, Mapping) or not raw_buttons:
        raise ConfigError("'buttons' must be a non-empty mapping")
    buttons: List[ButtonConfig] = []
    used_pins: Dict[int, str] = {}
    for name, raw in raw_buttons.items():
        button = _parse_button(str(name), raw, poll_interval_ms)
        if button.valid:
            if button.pin in used_pins:
                _invalidate(button, f"pin {pin_name(button.pin)} is already used by "
                                    f"button '{used_pins[button.pin]}'")
            else:
                used_pins[button.pin] = button.name
        buttons.append(button)
    return McpConfig(bus=bus, address=address, chip=chip,
                     poll_interval_ms=poll_interval_ms, buttons=buttons)


def _parse_button(name: str, raw: Any, poll_interval_ms: int) -> ButtonConfig:
    button = ButtonConfig(name=name)
    if not isinstance(raw, Mapping):
        return _invalidate(button, 'button entry must be a mapping')
    unknown = set(raw) - BUTTON_KEYS
    if unknown:
        keys = ', '.join(sorted(str(key) for key in unknown))
        return _invalidate(button, f'unknown key(s): {keys}')
    try:
        button.pin = parse_pin(raw.get('pin'))
        button.type = _button_type(raw.get('type'))
        button.active_low = _bool_value(raw.get('active_low', True), 'active_low')
        button.pull_up = _pull_up(raw.get('pull_up', 'internal'))
        button.debounce_ms = _int_value(raw.get('debounce_ms'), 'debounce_ms', 0, 60000)
        if button.debounce_ms < poll_interval_ms:
            raise ConfigError(f"'debounce_ms' must be at least the poll interval "
                              f"({poll_interval_ms} ms)")
        button.hold_ms = _hold_ms(raw.get('hold_ms'), button.type, poll_interval_ms)
        button.actions = _parse_actions(raw.get('actions'), button.type)
        _check_polarity(button)
    except ConfigError as error:
        return _invalidate(button, str(error))
    button.valid = True
    return button


def _button_type(value: Any) -> str:
    if not isinstance(value, str) or value not in BUTTON_TYPES:
        raise ConfigError(f"'type' must be one of {', '.join(BUTTON_TYPES)}")
    return value


def _pull_up(value: Any) -> str:
    if not isinstance(value, str) or value not in PULL_UP_MODES:
        raise ConfigError(f"'pull_up' must be one of {', '.join(PULL_UP_MODES)}")
    return value


def _hold_ms(value: Any, button_type: str, poll_interval_ms: int) -> Optional[int]:
    needs_hold = button_type in ('long_press', 'short_long_press', 'hold_repeat')
    if not needs_hold:
        if value is not None:
            raise ConfigError(f"'hold_ms' is not used by type '{button_type}'")
        return None
    if value is None:
        raise ConfigError(f"'hold_ms' is required for type '{button_type}'")
    hold_ms = _int_value(value, 'hold_ms', 0, 600000)
    if hold_ms < 2 * poll_interval_ms:
        raise ConfigError(f"'hold_ms' must be at least twice the poll interval "
                          f"({2 * poll_interval_ms} ms)")
    return hold_ms


def _parse_actions(raw: Any, button_type: str) -> Dict[str, ActionSpec]:
    if not isinstance(raw, Mapping) or not raw:
        raise ConfigError("'actions' must be a non-empty mapping")
    allowed = ACTION_KEYS[button_type]
    unknown = set(raw) - set(allowed)
    if unknown:
        keys = ', '.join(sorted(str(key) for key in unknown))
        raise ConfigError(f"action key(s) not allowed for type '{button_type}': {keys}")
    actions: Dict[str, ActionSpec] = {}
    for key in allowed:
        if key not in raw:
            continue
        try:
            actions[key] = parse_action(raw[key])
        except ActionError as error:
            raise ConfigError(f"action '{key}': {error}")
    if not actions:
        raise ConfigError(f"type '{button_type}' needs one of: {', '.join(allowed)}")
    return actions


def _check_polarity(button: ButtonConfig) -> None:
    if button.pull_up == 'internal' and not button.active_low:
        raise ConfigError("'pull_up: internal' requires 'active_low: true'")
    if button.pull_up == 'none':
        logger.warning("Button '%s' uses 'pull_up: none'; its idle level is undefined",
                       button.name)


def _invalidate(button: ButtonConfig, message: str) -> ButtonConfig:
    button.valid = False
    button.error = message
    return button


def _bool_value(value: Any, name: str) -> bool:
    if not isinstance(value, bool):
        raise ConfigError(f"'{name}' must be true or false")
    return value


def _chip_value(value: Any) -> Optional[int]:
    if isinstance(value, str) and value.strip().lower() == 'auto':
        return None
    return _int_value(value, 'chip', 0, 1024)


def _int_value(value: Any, name: str, minimum: int, maximum: int) -> int:
    if value is None:
        raise ConfigError(f"'{name}' is required")
    if isinstance(value, bool):
        raise ConfigError(f"'{name}' must be a number")
    if isinstance(value, int):
        number = value
    elif isinstance(value, str):
        text = value.strip()
        try:
            number = int(text, 16) if text.lower().startswith('0x') else int(text, 10)
        except ValueError:
            raise ConfigError(f"'{name}' must be a number, got '{value}'")
    else:
        raise ConfigError(f"'{name}' must be a number, got '{value}'")
    if not minimum <= number <= maximum:
        raise ConfigError(f"'{name}' must be between {minimum} and {maximum}, got '{value}'")
    return number
