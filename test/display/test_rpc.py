"""Tests for the display RPC facade."""

import importlib
import sys
from pathlib import Path

import pytest


sys.path.insert(0, str(Path(__file__).parents[2] / 'src/jukebox'))


def _identity_register(func=None, **kwargs):
    if func is None:
        return lambda inner: inner
    return func


@pytest.fixture(scope='module')
def display_module():
    import jukebox.plugs as plugin

    saved = (plugin.register, plugin.initialize, plugin.atexit)
    plugin.register = _identity_register
    plugin.initialize = lambda func: func
    plugin.atexit = lambda func: func
    try:
        module = importlib.import_module('components.display')
    finally:
        plugin.register, plugin.initialize, plugin.atexit = saved
    return module


class FakeConfig:
    def __init__(self, values=None):
        self.values = dict(values or {})

    def getn(self, *keys, default=None):
        node = self.values
        for key in keys:
            if not isinstance(node, dict) or key not in node:
                return default
            node = node[key]
        return node

    def setndefault(self, *keys, value):
        node = self.values
        for key in keys[:-1]:
            node = node.setdefault(key, {})
        node.setdefault(keys[-1], value)


class FakeMachine:
    def __init__(self):
        self.calls = []
        self.status = {
            'state': 'active',
            'power': True,
            'brightness_percent': 50,
            'dim_brightness_percent': 10,
            'dim_timeout_min': 2,
            'standby_timeout_min': 5,
            'music_mode': 'normal',
            'standby_mechanic': 'auto',
            'standby_mechanic_active': 'backlight',
            'brightness_source': 'sysfs',
            'max_brightness': 255,
            'backlight_device': 'panel',
            'dim_available': True,
            'busy': False,
            'errors': ['no_backlight_device'],
        }
        self.closed = False

    def get_status(self):
        return dict(self.status)

    def set_brightness(self, percent):
        self.calls.append(('brightness', percent))

    def set_dim_brightness(self, percent):
        self.calls.append(('dim_brightness', percent))

    def set_timeouts(self, dim_min, standby_min):
        self.calls.append(('timeouts', dim_min, standby_min))

    def set_music_mode(self, mode):
        self.calls.append(('music_mode', mode))

    def set_standby_mechanic(self, mechanic):
        self.calls.append(('mechanic', mechanic))

    def set_power(self, on):
        self.calls.append(('power', on))

    def close(self):
        self.closed = True


class FakeMonitor:
    def __init__(self):
        self.errors = ['no_input_access']
        self.interactions = 0
        self.stopped = False

    def interaction(self):
        self.interactions += 1

    def stop(self):
        self.stopped = True


class FakeDriver:
    def __init__(self):
        self.initial = None
        self.shutdown_called = False

    def apply_initial(self, percent):
        self.initial = percent

    def shutdown(self):
        self.shutdown_called = True


class Publisher:
    def __init__(self):
        self.messages = []

    def send(self, topic, payload):
        self.messages.append((topic, dict(payload)))


@pytest.fixture
def state(display_module, monkeypatch):
    module = display_module
    module.cfg = FakeConfig()
    module.driver = FakeDriver()
    module.machine = FakeMachine()
    module.monitor = FakeMonitor()
    module._unavailable = False
    module._stopped = False
    publisher = Publisher()
    monkeypatch.setattr(
        module.publishing,
        'get_publisher',
        lambda: publisher,
    )
    return module, publisher


def test_facade_exposes_all_calls(display_module):
    for name in (
            'status',
            'set_brightness',
            'set_dim_brightness',
            'set_timeouts',
            'set_music_mode',
            'set_standby_mechanic',
            'set_power',
            'activity'):
        assert callable(getattr(display_module, name))


def test_status_merges_monitor_errors(state):
    module, _ = state

    result = module.status()

    assert 'no_backlight_device' in result['errors']
    assert 'no_input_access' in result['errors']


def test_setters_delegate_and_return_status(state):
    module, _ = state
    machine = module.machine

    assert module.set_brightness(60)['brightness_percent'] == 50
    assert module.set_dim_brightness(10)['state'] == 'active'
    assert module.set_timeouts(1, 2)['state'] == 'active'
    assert module.set_music_mode('normal')['state'] == 'active'
    assert module.set_standby_mechanic('auto')['state'] == 'active'
    assert module.set_power(False)['state'] == 'active'

    assert machine.calls == [
        ('brightness', 60),
        ('dim_brightness', 10),
        ('timeouts', 1, 2),
        ('music_mode', 'normal'),
        ('mechanic', 'auto'),
        ('power', False),
    ]


def test_activity_delegates_to_monitor(state):
    module, _ = state

    module.activity()

    assert module.monitor.interactions == 1


def test_unavailable_setters_raise(state):
    module, _ = state
    module._unavailable = True

    for call in (
            lambda: module.set_brightness(50),
            lambda: module.set_dim_brightness(10),
            lambda: module.set_timeouts(1, 2),
            lambda: module.set_music_mode('normal'),
            lambda: module.set_standby_mechanic('auto'),
            lambda: module.set_power(True)):
        with pytest.raises(RuntimeError, match='display_unavailable'):
            call()

    module.activity()
    result = module.status()
    assert result['state'] == 'active'
    assert result['power'] is True
    assert 'init_failed' in result['errors']


def test_publish_status_sends_on_display_status(state):
    module, publisher = state

    module.publish_status()

    assert publisher.messages
    topic, payload = publisher.messages[-1]
    assert topic == 'display.status'
    assert payload['state'] == 'active'


def test_apply_defaults_fills_the_display_section(state):
    module, _ = state

    module._apply_defaults()

    display = module.cfg.values['display']
    assert display['brightness'] == 100
    assert display['dim_brightness'] == 10
    assert display['dim_timeout_min'] == 2
    assert display['standby_timeout_min'] == 5
    assert display['standby_mechanic'] == 'auto'
    assert display['music_mode'] == 'normal'
    assert display['ddc_control'] == 'auto'
    assert display['x11_control'] == 'auto'
    assert display['button_devices'] == []


def test_initialize_failure_is_contained(state, monkeypatch):
    module, publisher = state
    module.driver = None
    module.machine = None
    module.monitor = None

    def failing_driver(*args, **kwargs):
        raise OSError('driver unavailable')

    monkeypatch.setattr(module, 'DisplayDriver', failing_driver)
    module.initialize()

    assert module._unavailable is True
    assert module.driver is None
    assert module.machine is None
    result = module.status()
    assert result['state'] == 'active'
    assert 'init_failed' in result['errors']
    with pytest.raises(RuntimeError, match='display_unavailable'):
        module.set_brightness(50)
    assert publisher.messages


def test_initialize_success_wires_components(state, monkeypatch):
    module, publisher = state
    created = {}

    class Driver:
        def __init__(self, config, status_callback=None):
            created['driver_config'] = config
            self.initial = None
            self.shutdown_called = False

        def apply_initial(self, percent):
            self.initial = percent

        def shutdown(self):
            self.shutdown_called = True

    class Machine:
        def __init__(self, cfg, driver, publish=None):
            created['machine'] = self
            self.states = []
            self.closed = False

        def get_status(self):
            return {
                'state': 'active',
                'power': True,
                'brightness_percent': 75,
                'errors': [],
            }

        def on_player_state(self, state):
            self.states.append(state)

        def close(self):
            self.closed = True

    class Monitor:
        def __init__(self, machine, touch_device='', button_devices=None):
            created['monitor'] = self
            self.errors = []
            self.started = False
            self.stopped = False
            self.interactions = 0

        def start(self):
            self.started = True

        def stop(self):
            self.stopped = True

        def interaction(self):
            self.interactions += 1

    monkeypatch.setattr(module, 'DisplayDriver', Driver)
    monkeypatch.setattr(module, 'DisplayStateMachine', Machine)
    monkeypatch.setattr(module, 'ActivityMonitor', Monitor)
    monkeypatch.setattr(
        module.plugin,
        'call',
        lambda *args, **kwargs: {'state': 'play'},
    )
    module.driver = None
    module.machine = None
    module.monitor = None

    module.initialize()

    driver = module.driver
    machine = module.machine
    monitor = module.monitor
    assert module._unavailable is False
    assert driver.initial == 75
    assert monitor.started is True
    assert machine.states == ['play']
    assert publisher.messages[-1][0] == 'display.status'

    module.atexit(0)
    module.atexit(0)

    assert monitor.stopped is True
    assert machine.closed is True
    assert driver.shutdown_called is True
