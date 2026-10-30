# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder
"""
Plugin entry point for the MCP23017 button support.

The plugin registers its control object before it touches the configuration or
the hardware, so ``mcp23017.ctrl.get_status()`` stays reachable when the
configuration file is missing or the expander does not answer.
"""

import logging
import time
from typing import Optional

import jukebox.cfghandler as cfghandler
import jukebox.plugs as plugin
from components.rpc_command_alias import cmd_alias_definitions

from .actions import ActionBinder
from .config import McpConfig, parse_config
from .ctrl import Ctrl
from .device import BackendError, LgpioBackend, LgpioChipProbe, detect_chip

logger = logging.getLogger('jb.mcp23017')

_STARTUP_TIMEOUT_SECONDS = 5.0
_STARTUP_RETRY_SECONDS = 0.1

_CTRL: Optional[Ctrl] = None
_BACKEND: Optional[LgpioBackend] = None
_CONFIG_FILE: Optional[str] = None
_CFG_MCP = None


@plugin.initialize
def initialize() -> None:
    global _CTRL
    _CTRL = Ctrl(clock=time.monotonic)
    plugin.register(_CTRL, package=plugin.loaded_as(__name__), name='ctrl', replace=True)
    cfg_main = cfghandler.get_handler('jukebox')
    enabled = bool(cfg_main.setndefault('mcp23017', 'enable', value=False))
    if not enabled:
        logger.info('MCP23017 button support is disabled')
        _CTRL.mark_disabled()
        return
    _CTRL.mark_enabled()
    try:
        config = _load_config(cfg_main)
    except Exception as error:
        _CTRL.mark_error(f'{error.__class__.__name__}: {error}')
        return
    _CTRL.load_config(config)
    _CTRL.set_config_path(_CONFIG_FILE, _reload_config)
    _CTRL.resolve_actions(cmd_alias_definitions)
    _start_hardware(config)


@plugin.finalize
def finalize() -> None:
    if _CTRL is None or not _CTRL.is_running:
        return
    _CTRL.bind_actions(ActionBinder())
    if not _CTRL.has_valid_buttons():
        logger.warning('No valid MCP23017 buttons configured; '
                       'polling starts for the settings page only')
    if not _CTRL.start_polling():
        logger.warning('MCP23017 polling could not be started')


@plugin.atexit
def plugin_atexit(signal_id: int, **ignored_kwargs) -> None:
    logger.info('Stopping MCP23017 button support')
    if _CTRL is not None:
        _CTRL.stop_polling()
    _close_backend()
    if _CTRL is not None:
        _CTRL.detach()


def _load_config(cfg_main) -> McpConfig:
    global _CONFIG_FILE, _CFG_MCP
    _CONFIG_FILE = cfg_main.setndefault('mcp23017', 'config_file',
                                        value='../../shared/settings/mcp23017.yaml')
    _CFG_MCP = cfghandler.get_handler('mcp23017')
    cfghandler.load_yaml(_CFG_MCP, _CONFIG_FILE)
    return parse_config(_CFG_MCP)


def _reload_config() -> McpConfig:
    """Reload the settings file after the settings page changed it."""
    cfghandler.load_yaml(_CFG_MCP, _CONFIG_FILE)
    return parse_config(_CFG_MCP)


def _start_hardware(config: McpConfig) -> None:
    global _BACKEND
    try:
        chip = _wait_for_chip(config)
        backend = LgpioBackend(chip, config.bus, config.address, list(range(16)))
        _BACKEND = backend
        backend.open()
        backend.check_bank()
        backend.write_gppu(config.gppu_mask)
        _CTRL.attach(config, backend, chip)
    except Exception as error:
        _close_backend()
        _CTRL.mark_error(f'{error.__class__.__name__}: {error}')
        return
    logger.info('MCP23017 buttons ready on gpiochip%s with GPPU mask 0x%04x',
                chip, config.gppu_mask)


def _wait_for_chip(config: McpConfig) -> int:
    probe = LgpioChipProbe()
    deadline = time.monotonic() + _STARTUP_TIMEOUT_SECONDS
    while True:
        try:
            return detect_chip(config.bus, config.address, config.chip, probe)
        except BackendError:
            if time.monotonic() >= deadline:
                raise
            time.sleep(_STARTUP_RETRY_SECONDS)


def _close_backend() -> None:
    global _BACKEND
    if _BACKEND is None:
        return
    try:
        _BACKEND.close()
    except Exception as error:
        logger.debug('Closing the MCP23017 backend failed: %s', error)
    _BACKEND = None
