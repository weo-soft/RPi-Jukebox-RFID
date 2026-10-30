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

from .actions import ActionBinder, ActionError, resolve_action
from .buttons import ButtonController
from .config import ButtonConfig, McpConfig
from .device import BackendError

logger = logging.getLogger('jb.mcp23017')

BOOT_CONFIG_PATHS = ('/boot/firmware/config.txt', '/boot/config.txt')
_OVERLAY_PATTERN = re.compile(r'^dtoverlay=mcp23017(?:,|$)')
_I2C_BUS_PATTERN = re.compile(r'^i2c(\d+)$')

_POLL_ERROR_LOG_SECONDS = 60.0
_GPPU_REWRITE_SECONDS = 5.0


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
                 boot_config_paths: Sequence[str] = BOOT_CONFIG_PATHS):
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
        """Start the polling thread when the plugin is running and has buttons."""
        if not self.is_running or not self.has_valid_buttons() or self._backend is None:
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

    def poll_once(self, now: float) -> None:
        """Run one polling cycle; used by the thread and by tests."""
        if self._controller is not None:
            self._controller.poll(now)

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

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------
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


def resolve_and_bind(ctrl: Ctrl, known_aliases: Dict[str, Dict[str, Any]],
                     binder: Optional[ActionBinder] = None) -> None:
    """Convenience helper for tests: resolve all actions and bind them."""
    ctrl.resolve_actions(known_aliases)
    ctrl.bind_actions(binder or ActionBinder())
