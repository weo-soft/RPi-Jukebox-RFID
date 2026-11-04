"""Display plugin: brightness, dimming and standby control.

The module exposes the RPC facade used by the WebApp.  It owns the driver,
the state machine and the interaction monitor, publishes ``display.status``
and keeps the plugin usable when initialization fails.
"""

import logging

import jukebox.cfghandler
import jukebox.plugs as plugin
import jukebox.publishing as publishing

from .activity import ActivityMonitor
from .driver import DisplayDriver
from .state_machine import DisplayStateMachine

logger = logging.getLogger('jb.display')

cfg = jukebox.cfghandler.get_handler('jukebox')

driver = None
machine = None
monitor = None
_unavailable = False
_stopped = False

_DEFAULTS = {
    'backlight_device': '',
    'ddc_control': 'auto',
    'ddc_display': 1,
    'x11_control': 'auto',
    'x11_output': '',
    'brightness': 100,
    'dim_brightness': 10,
    'dim_timeout_min': 2,
    'standby_timeout_min': 5,
    'standby_mechanic': 'auto',
    'music_mode': 'normal',
    'touch_device': '',
    'button_devices': [],
}

_FALLBACK = {
    'state': 'active',
    'power': True,
    'brightness_percent': 100,
    'dim_brightness_percent': 10,
    'dim_timeout_min': 2,
    'standby_timeout_min': 5,
    'music_mode': 'normal',
    'standby_mechanic': 'auto',
    'standby_mechanic_active': None,
    'brightness_source': None,
    'max_brightness': None,
    'backlight_device': '',
    'dim_available': False,
    'busy': False,
    'errors': ['init_failed'],
}


def _apply_defaults():
    for key, value in _DEFAULTS.items():
        cfg.setndefault('display', key, value=value)


def _driver_config():
    return {
        'backlight_device': cfg.getn(
            'display',
            'backlight_device',
            default='',
        ),
        'ddc_control': cfg.getn('display', 'ddc_control', default='auto'),
        'ddc_display': cfg.getn('display', 'ddc_display', default=1),
        'x11_control': cfg.getn('display', 'x11_control', default='auto'),
        'x11_output': cfg.getn('display', 'x11_output', default=''),
        'brightness': cfg.getn('display', 'brightness', default=100),
        'standby_mechanic': cfg.getn(
            'display',
            'standby_mechanic',
            default='auto',
        ),
    }


@plugin.initialize
def initialize():
    """Create the driver, state machine and interaction monitor."""
    global driver, machine, monitor, _unavailable
    try:
        _apply_defaults()
        driver = DisplayDriver(
            _driver_config(),
            status_callback=publish_status,
        )
        machine = DisplayStateMachine(cfg, driver, publish=publish_status)
        driver.apply_initial(machine.get_status()['brightness_percent'])
        monitor = ActivityMonitor(
            machine,
            touch_device=cfg.getn('display', 'touch_device', default=''),
            button_devices=cfg.getn(
                'display',
                'button_devices',
                default=[],
            ),
        )
        monitor.start()
        _apply_initial_player_state()
        _unavailable = False
        publish_status()
    except Exception as error:
        _unavailable = True
        logger.exception('Display plugin initialization failed: %s', error)
        publish_status()


def _apply_initial_player_state():
    try:
        player_status = plugin.call('player', 'ctrl', 'playerstatus')
    except Exception as error:
        logger.warning(
            'Could not read the initial player status: %s',
            error,
        )
        return
    if not isinstance(player_status, dict):
        return
    state = player_status.get('state')
    if isinstance(state, str):
        machine.on_player_state(state)


@plugin.atexit
def atexit(sig):
    """Stop the monitor, cancel the timers and close the driver."""
    global _stopped
    if _stopped:
        return
    _stopped = True
    try:
        if monitor is not None:
            monitor.stop()
    except Exception as error:
        logger.warning('Could not stop the display monitor: %s', error)
    try:
        if machine is not None:
            machine.close()
    except Exception as error:
        logger.warning('Could not close the display state machine: %s', error)
    try:
        if driver is not None:
            driver.shutdown()
    except Exception as error:
        logger.warning('Could not shut down the display driver: %s', error)


def publish_status():
    """Publish the complete display status."""
    payload = status()
    try:
        publishing.get_publisher().send('display.status', payload)
    except Exception as error:
        logger.warning('Could not publish display status: %s', error)


def _require_available():
    if _unavailable or driver is None or machine is None:
        raise RuntimeError('display_unavailable')


@plugin.register
def status():
    """Return the complete display status."""
    if machine is None:
        payload = dict(_FALLBACK)
    else:
        payload = machine.get_status()
    errors = set(payload.get('errors') or [])
    if monitor is not None:
        errors.update(monitor.errors)
    if _unavailable:
        errors.add('init_failed')
        payload['state'] = 'active'
        payload['power'] = True
    payload['errors'] = sorted(errors)
    return payload


@plugin.register
def set_brightness(percent):
    """Set the active brightness and persist it."""
    _require_available()
    machine.set_brightness(percent)
    return status()


@plugin.register
def set_dim_brightness(percent):
    """Set the dimmed brightness and persist it."""
    _require_available()
    machine.set_dim_brightness(percent)
    return status()


@plugin.register
def set_timeouts(dim_min, standby_min):
    """Set the dim and standby timeouts and persist them."""
    _require_available()
    machine.set_timeouts(dim_min, standby_min)
    return status()


@plugin.register
def set_music_mode(mode):
    """Set the music-dependent transition policy and persist it."""
    _require_available()
    machine.set_music_mode(mode)
    return status()


@plugin.register
def set_standby_mechanic(mechanic):
    """Set the standby mechanic and persist it."""
    _require_available()
    machine.set_standby_mechanic(mechanic)
    return status()


@plugin.register
def set_power(on):
    """Switch the display on or off manually."""
    _require_available()
    machine.set_power(on)
    return status()


@plugin.register
def activity():
    """Reset the inactivity timers from a WebApp interaction."""
    if monitor is not None and not _unavailable:
        monitor.interaction()
