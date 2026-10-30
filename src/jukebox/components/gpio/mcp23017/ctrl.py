# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder
"""
Control object of the MCP23017 button plugin.

The object is registered as ``mcp23017.ctrl`` and keeps the plugin state even
when no hardware is present, so status and diagnostic calls keep working after
a configuration or hardware error.
"""

import logging
import os
import re
import threading
import time
from typing import Any, Callable, Dict, List, Optional, Sequence

import jukebox.plugs as plugin
from components.rpc_command_alias import cmd_alias_definitions

from .actions import ActionBinder, ActionError, resolve_action
from .buttons import ButtonController
from .catalog import action_entry, action_id_for, catalog_entries
from .config import ButtonConfig, ConfigError, McpConfig, parse_pin, pin_name
from .device import BackendError
from .settings import assign_button, clear_button as clear_button_assignment

logger = logging.getLogger('jb.mcp23017')

BOOT_CONFIG_PATHS = ('/boot/firmware/config.txt', '/boot/config.txt')
_OVERLAY_PATTERN = re.compile(r'^dtoverlay=mcp23017(?:,|$)')
_I2C_BUS_PATTERN = re.compile(r'^i2c(\d+)$')

_POLL_ERROR_LOG_SECONDS = 60.0
_GPPU_REWRITE_SECONDS = 5.0
_LEARN_TIMEOUT_SECONDS = 15.0
_LEARN_RESULT_SECONDS = 30.0
_LEARN_DEBOUNCE_SECONDS = 0.05
_ALL_PULLUPS = 0xffff

_PRIMARY_ACTION = {
    'momentary': ('on_press',),
    'hold_repeat': ('on_press',),
    'long_press': ('on_long_press',),
    'short_long_press': ('on_short_press', 'on_long_press'),
}


def read_overlay(config: Optional[McpConfig],
                 paths: Sequence[str] = BOOT_CONFIG_PATHS) -> Optional[Dict[str, Any]]:
    """Read the mcp23017 overlay line from the boot configuration, if present."""
    path = next((candidate for candidate in paths if os.path.isfile(candidate)), None)
    if path is None:
        return None
    try:
        with open(path, encoding='utf-8', errors='replace') as stream:
            lines = stream.readlines()
    except OSError:
        return None
    for number, line in enumerate(lines, 1):
        stripped = line.strip()
        if not _OVERLAY_PATTERN.match(stripped):
            continue
        address, bus, noints = _parse_overlay_parameters(stripped)
        match = None
        if config is not None:
            match = address == config.address and bus == config.bus and noints
        return {
            'path': path,
            'line': number,
            'address': f'0x{address:02x}' if address is not None else None,
            'bus': bus,
            'noints': noints,
            'match': match,
        }
    return None


def _parse_overlay_parameters(line: str):
    address: Optional[int] = None
    bus: Optional[int] = None
    noints = False
    for parameter in line.split(',')[1:]:
        parameter = parameter.strip()
        if parameter == 'noints':
            noints = True
        elif parameter.startswith('addr='):
            try:
                address = int(parameter[5:], 16)
            except ValueError:
                address = None
        else:
            match = _I2C_BUS_PATTERN.match(parameter)
            if match:
                bus = int(match.group(1))
    return address, bus, noints


class Ctrl:
    """Plugin state, polling thread and RPC surface of the MCP23017 buttons."""

    def __init__(self, clock: Callable[[], float] = time.monotonic,
                 boot_config_paths: Sequence[str] = BOOT_CONFIG_PATHS,
                 config_path: Optional[str] = None,
                 reload_config: Optional[Callable[[], McpConfig]] = None,
                 binder: Optional[ActionBinder] = None):
        self._clock = clock
        self._boot_config_paths = tuple(boot_config_paths)
        self._config: Optional[McpConfig] = None
        self._backend = None
        self._controller: Optional[ButtonController] = None
        self._bindings: Dict[str, Dict[str, Callable[[], Any]]] = {}
        self._thread: Optional[threading.Thread] = None
        self._stop = threading.Event()
        self._state = 'disabled'
        self._enabled = False
        self._last_error: Optional[str] = None
        self._gpiochip: Optional[int] = None
        self._gppu_mask = 0
        self._last_poll_error_log: Optional[float] = None
        self._last_gppu_rewrite: Optional[float] = None
        self._config_path = config_path
        self._reload_config = reload_config
        self._binder = binder or ActionBinder()
        self._apply_lock = threading.RLock()
        self._learn_lock = threading.Lock()
        self._learn: Optional[Dict[str, Any]] = None

    def set_config_path(self, path: str,
                        reload_config: Callable[[], McpConfig]) -> None:
        """Provide the settings file and the reload callback for the UI."""
        self._config_path = path
        self._reload_config = reload_config

    # ------------------------------------------------------------------
    # Lifecycle, called by the plugin entry point
    # ------------------------------------------------------------------
    @property
    def state(self) -> str:
        return self._state

    @property
    def is_running(self) -> bool:
        return self._state == 'running'

    def mark_disabled(self) -> None:
        self._state = 'disabled'
        self._enabled = False

    def mark_enabled(self) -> None:
        self._enabled = True

    def mark_error(self, message: str) -> None:
        self._state = 'error'
        self._last_error = message
        logger.error('MCP23017 buttons disabled: %s', message)

    def load_config(self, config: McpConfig) -> None:
        self._config = config

    def resolve_actions(self, known_aliases: Dict[str, Dict[str, Any]]) -> None:
        """Resolve configured aliases; a broken button is marked invalid."""
        if self._config is None:
            return
        for button in self._config.valid_buttons:
            for key, spec in button.actions.items():
                try:
                    button.resolved[key] = resolve_action(spec, known_aliases)
                except ActionError as error:
                    self._invalidate(button, f"action '{key}': {error}")
                    break

    def attach(self, config: McpConfig, backend: Any, gpiochip: int) -> None:
        self._config = config
        self._backend = backend
        self._gpiochip = gpiochip
        self._gppu_mask = config.gppu_mask
        self._state = 'running'

    def bind_actions(self, binder: ActionBinder) -> None:
        """Bind resolved actions; a failing binding marks the button invalid."""
        if self._config is None:
            return
        for button in self._config.valid_buttons:
            for key, action in button.resolved.items():
                try:
                    self._bindings.setdefault(button.name, {})[key] = binder.bind(action)
                except Exception as error:
                    self._invalidate(button, f"action '{key}': "
                                             f'{error.__class__.__name__}: {error}')
                    break

    def has_valid_buttons(self) -> bool:
        return self._config is not None and bool(self._config.valid_buttons)

    def start_polling(self) -> bool:
        """Start the polling thread while the plugin is running.

        The thread also runs without configured buttons: the settings page
        needs it to detect a button during learning.
        """
        if not self.is_running or self._backend is None:
            return False
        self._controller = ButtonController(self._config.buttons, self._backend.read_pin,
                                            self._bindings, self._clock)
        self._stop.clear()
        self._thread = threading.Thread(target=self._poll_loop, name='mcp23017-poll',
                                        daemon=True)
        self._thread.start()
        return True

    def stop_polling(self) -> None:
        self._stop.set()
        thread = self._thread
        if thread is not None and thread.is_alive() and thread is not threading.current_thread():
            thread.join()
        self._thread = None

    def detach(self) -> None:
        self._controller = None
        self._backend = None
        self._bindings = {}
        with self._learn_lock:
            self._learn = None

    def _restore_gppu(self) -> None:
        if self._backend is None:
            return
        try:
            self._backend.write_gppu(self._gppu_mask)
        except Exception as error:
            logger.error('Restoring the GPPU mask after learning failed: %s', error)

    def poll_once(self, now: float) -> None:
        """Run one polling cycle; used by the thread and by tests."""
        with self._learn_lock:
            learn = self._learn
        if learn is not None:
            if learn['state'] == 'waiting':
                self._poll_learn(now)
                return
            if now < learn['deadline']:
                # Keep the buttons silent while the settings page consumes
                # the learned pin, so the learned press cannot fire the old
                # action.
                return
            with self._learn_lock:
                self._learn = None
        if self._controller is not None:
            self._controller.poll(now)

    def _poll_learn(self, now: float) -> None:
        finished = False
        with self._learn_lock:
            learn = self._learn
            if learn is None or learn['state'] != 'waiting':
                return
            if now >= learn['deadline']:
                learn['state'] = 'timeout'
                learn['deadline'] = now + _LEARN_RESULT_SECONDS
                finished = True
            else:
                for line in range(16):
                    raw = self._backend.read_pin(line)
                    state = learn['raw'].setdefault(line, {'last': None, 'since': now})
                    if state['last'] != raw:
                        state['last'] = raw
                        state['since'] = now
                    if raw == 0 and now - state['since'] >= _LEARN_DEBOUNCE_SECONDS:
                        learn['pin'] = line
                        learn['state'] = 'learned'
                        learn['deadline'] = now + _LEARN_RESULT_SECONDS
                        finished = True
                        break
        if finished:
            self._restore_gppu()

    def _poll_loop(self) -> None:
        while not self._stop.is_set():
            interval = self._config.poll_interval_seconds if self._config else 0.025
            try:
                self.poll_once(self._clock())
            except Exception as error:
                self._handle_poll_error(error)
            self._stop.wait(interval)

    def _handle_poll_error(self, error: Exception) -> None:
        now = self._clock()
        self._last_error = f'{error.__class__.__name__}: {error}'
        if self._last_poll_error_log is None \
                or now - self._last_poll_error_log >= _POLL_ERROR_LOG_SECONDS:
            logger.error('Polling the MCP23017 failed: %s', self._last_error)
            self._last_poll_error_log = now
        self._rewrite_gppu(now)

    def _rewrite_gppu(self, now: float) -> None:
        if self._backend is None:
            return
        if self._last_gppu_rewrite is not None \
                and now - self._last_gppu_rewrite < _GPPU_REWRITE_SECONDS:
            return
        self._last_gppu_rewrite = now
        try:
            self._backend.write_gppu(self._gppu_mask)
        except BackendError as error:
            logger.error('Rewriting GPPU failed: %s', error)

    def _invalidate(self, button: ButtonConfig, message: str) -> None:
        button.valid = False
        button.error = message
        logger.error("Button '%s' is invalid: %s", button.name, message)

    # ------------------------------------------------------------------
    # RPC interface
    # ------------------------------------------------------------------
    @plugin.tag
    def get_status(self) -> Dict[str, Any]:
        """Return the plugin state, the device settings and the button states."""
        config = self._config
        return {
            'enabled': self._enabled,
            'state': self._state,
            'bus': config.bus if config else None,
            'address': config.address_hex if config else None,
            'gpiochip': self._gpiochip,
            'poll_interval_ms': config.poll_interval_ms if config else None,
            'gppu_mask': self._gppu_mask,
            'gppu_readback': self._read_gppu(),
            'last_error': self._last_error,
            'overlay': self._read_overlay(),
            'buttons': [self._button_status(button) for button in config.buttons]
            if config else [],
        }

    @plugin.tag
    def list_buttons(self) -> List[Dict[str, Any]]:
        """Return the configured buttons with their resolved actions."""
        if self._config is None:
            return []
        entries = []
        for button in self._config.buttons:
            actions: Dict[str, Any] = {}
            if button.valid:
                for key, action in button.resolved.items():
                    actions[key] = {'source': action.source, 'target': action.target()}
            entries.append({
                'name': button.name,
                'pin': button.pin,
                'type': button.type,
                'valid': button.valid,
                'error': button.error,
                'actions': actions,
            })
        return entries

    @plugin.tag
    def get_button_settings(self) -> Dict[str, Any]:
        """Return the assignable actions and the assignment of all 16 pins."""
        config = self._config
        pins = []
        for line in range(16):
            button = None
            if config is not None:
                button = next((entry for entry in config.buttons if entry.pin == line), None)
            action_id = action_id_for(button) if button is not None and button.valid else None
            pins.append({
                'pin': line,
                'name': pin_name(line),
                'assigned': button is not None,
                'button': button.name if button is not None else None,
                'action_id': action_id,
                'type': button.type if button is not None else None,
                'advanced': button is not None and action_id is None,
                'valid': button.valid if button is not None else True,
                'error': button.error if button is not None else None,
            })
        return {
            'state': self._state,
            'enabled': self._enabled,
            'bus': config.bus if config else None,
            'address': config.address_hex if config else None,
            'config_file': self._config_path,
            'last_error': self._last_error,
            'actions': catalog_entries(),
            'pins': pins,
        }

    @plugin.tag
    def set_button(self, pin: int, action_id: str) -> Dict[str, Any]:
        """Assign one catalog action to a pin and apply it without a restart."""
        self._require_writable()
        line = self._pin_or_raise(pin)
        action = action_entry(action_id)
        if action is None:
            raise ValueError(f"Unknown action '{action_id}'")
        assign_button(self._config_path, line, action,
                      self._config.bus, self._config.address)
        self._apply_config(self._reload_config())
        return self.get_button_settings()

    @plugin.tag
    def clear_button(self, pin: int) -> Dict[str, Any]:
        """Remove the assignment of one pin and apply it without a restart."""
        self._require_writable()
        line = self._pin_or_raise(pin)
        clear_button_assignment(self._config_path, line,
                                self._config.bus, self._config.address)
        self._apply_config(self._reload_config())
        return self.get_button_settings()

    @plugin.tag
    def start_learn(self, action_id: str) -> Dict[str, Any]:
        """Start a learn session; the next stable press is reported."""
        self._require_writable()
        if action_entry(action_id) is None:
            raise ValueError(f"Unknown action '{action_id}'")
        now = self._clock()
        with self._learn_lock:
            self._learn = {
                'action_id': action_id,
                'state': 'waiting',
                'pin': None,
                'deadline': now + _LEARN_TIMEOUT_SECONDS,
                'raw': {},
            }
        try:
            self._backend.write_gppu(_ALL_PULLUPS)
        except Exception as error:
            with self._learn_lock:
                self._learn = None
            raise RuntimeError(f'Cannot enable the pull-ups for learning: {error}')
        return self.get_learn_state()

    @plugin.tag
    def get_learn_state(self) -> Dict[str, Any]:
        """Return the state of the current learn session."""
        with self._learn_lock:
            learn = self._learn
            if learn is None:
                return {'state': 'idle', 'action_id': None, 'pin': None,
                        'remaining_seconds': None}
            remaining = max(0.0, learn['deadline'] - self._clock())
            return {
                'state': learn['state'],
                'action_id': learn['action_id'],
                'pin': learn['pin'],
                'remaining_seconds': round(remaining, 1),
            }

    @plugin.tag
    def cancel_learn(self) -> Dict[str, Any]:
        """Stop a running learn session and restore the pull-up mask."""
        with self._learn_lock:
            waiting = self._learn is not None and self._learn['state'] == 'waiting'
            self._learn = None
        if waiting:
            self._restore_gppu()
        return self.get_learn_state()

    @plugin.tag
    def test_button(self, name: str, execute: bool = False,
                    force: bool = False) -> Dict[str, Any]:
        """Simulate or run the primary action of one button."""
        if self._config is None:
            raise RuntimeError('MCP23017 plugin is disabled')
        if self._state != 'running':
            raise RuntimeError(f'MCP23017 plugin is {self._state}: '
                               f"{self._last_error or 'not initialized'}")
        button = next((entry for entry in self._config.buttons if entry.name == name), None)
        if button is None:
            raise ValueError(f"Unknown button '{name}'")
        if not button.valid:
            raise RuntimeError(f"Button '{name}' is invalid: {button.error}")
        key = _primary_action_key(button)
        action = button.resolved.get(key)
        if action is None:
            raise RuntimeError(f"Button '{name}' has no resolved action '{key}'")
        if self._backend is None:
            raise RuntimeError('MCP23017 backend is not attached')
        value = self._backend.read_pin(button.pin)
        blocked = (execute and not force and action.package == 'host'
                   and action.plugin in ('shutdown', 'reboot'))
        executed = False
        result = None
        if execute and not blocked:
            function = self._bindings.get(name, {}).get(key)
            if function is None:
                raise RuntimeError(f"Button '{name}' action '{key}' is not bound")
            result = function()
            executed = True
        return {
            'button': name,
            'pin': button.pin,
            'value': value,
            'type': button.type,
            'target': action.target(),
            'executed': executed,
            'blocked': blocked,
            'result': result,
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
    def _require_writable(self) -> None:
        if not self.is_running or self._backend is None:
            raise RuntimeError('MCP23017 plugin is not running')
        if self._config is None or self._config_path is None or self._reload_config is None:
            raise RuntimeError('MCP23017 settings persistence is not configured')

    @staticmethod
    def _pin_or_raise(pin: Any) -> int:
        try:
            return parse_pin(pin)
        except ConfigError as error:
            raise ValueError(str(error))

    def _apply_config(self, config: McpConfig) -> None:
        """Apply a reloaded configuration without restarting the daemon."""
        with self._apply_lock:
            was_polling = self._thread is not None and self._thread.is_alive()
            self.stop_polling()
            with self._learn_lock:
                self._learn = None
            self._config = config
            self._controller = None
            self._bindings = {}
            self.resolve_actions(cmd_alias_definitions)
            self.bind_actions(self._binder)
            self._gppu_mask = config.gppu_mask
            try:
                self._backend.write_gppu(self._gppu_mask)
            except Exception as error:
                self.mark_error(f'{error.__class__.__name__}: {error}')
                raise
            if was_polling:
                self.start_polling()

    def _read_gppu(self) -> Optional[int]:
        if self._backend is None:
            return None
        try:
            return self._backend.read_gppu()
        except Exception as error:
            logger.debug('Reading GPPU failed: %s', error)
            return None

    def _read_overlay(self) -> Optional[Dict[str, Any]]:
        return read_overlay(self._config, self._boot_config_paths)

    def _button_status(self, button: ButtonConfig) -> Dict[str, Any]:
        if not button.valid:
            state = 'invalid'
        elif self._controller is not None:
            state = self._controller.states.get(button.name, 'idle')
        else:
            state = 'idle'
        return {
            'name': button.name,
            'pin': button.pin,
            'type': button.type,
            'state': state,
            'valid': button.valid,
            'error': button.error,
        }


def _primary_action_key(button: ButtonConfig) -> str:
    for key in _PRIMARY_ACTION.get(button.type, ()):
        if key in button.resolved:
            return key
    return next(iter(button.resolved))


def resolve_and_bind(ctrl: Ctrl, known_aliases: Dict[str, Dict[str, Any]],
                     binder: Optional[ActionBinder] = None) -> None:
    """Convenience helper for tests: resolve all actions and bind them."""
    ctrl.resolve_actions(known_aliases)
    ctrl.bind_actions(binder or ActionBinder())
