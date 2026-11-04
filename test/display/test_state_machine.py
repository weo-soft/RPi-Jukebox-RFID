"""Tests for the display state machine."""

import importlib.util
import threading
from pathlib import Path

import pytest


MODULE_PATH = (
    Path(__file__).parents[2]
    / 'src/jukebox/components/display/state_machine.py'
)
SPEC = importlib.util.spec_from_file_location(
    'display_state_machine_under_test',
    MODULE_PATH,
)
state_machine = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(state_machine)

DisplayStateMachine = state_machine.DisplayStateMachine
STATE_ACTIVE = state_machine.STATE_ACTIVE
STATE_DIMMED = state_machine.STATE_DIMMED
STATE_STANDBY = state_machine.STATE_STANDBY


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class FakeTimer:
    def __init__(self, name, seconds, callback):
        self.name = name
        self.seconds = seconds
        self.callback = callback
        self.starts = []
        self.cancel_count = 0

    def start(self, seconds=None, restart=True):
        if seconds is not None:
            self.seconds = seconds
        self.starts.append(self.seconds)

    def cancel(self):
        self.cancel_count += 1

    def fire(self):
        self.callback()


class TimerFactory:
    def __init__(self):
        self.timers = []

    def __call__(self, name, seconds, callback):
        timer = FakeTimer(name, seconds, callback)
        self.timers.append(timer)
        return timer


class FakeConfig:
    def __init__(self, values=None):
        self.values = dict(values or {})
        self.saved = []
        self.fail_save = False
        self.lock = threading.RLock()

    def __enter__(self):
        self.lock.acquire()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.lock.release()

    def getn(self, *keys, default=None):
        node = self.values
        for key in keys:
            if not isinstance(node, dict) or key not in node:
                return default
            node = node[key]
        return node

    def setn(self, *keys, value):
        node = self.values
        for key in keys[:-1]:
            node = node.setdefault(key, {})
        node[keys[-1]] = value

    def save(self, only_if_changed=False):
        if self.fail_save:
            raise OSError('disk full')
        self.saved.append(dict(self.values.get('display', {})))


class FakeDriver:
    def __init__(
            self,
            brightness_source='sysfs',
            power_path='vcgencmd',
            mechanic='backlight'):
        self.brightness_source = brightness_source
        self.power_path = power_path
        self.mechanic = mechanic
        self.percents = []
        self.powers = []

    def set_percent(self, percent):
        self.percents.append(percent)

    def set_power(self, on):
        self.powers.append(on)

    def set_standby_mechanic(self, mechanic):
        self.mechanic = mechanic

    def resolve_standby_mechanic(self):
        return self.mechanic

    def get_status(self):
        return {
            'brightness_source': self.brightness_source,
            'max_brightness': (
                self.brightness_source == 'sysfs' and 255 or None
            ),
            'backlight_device': (
                'panel' if self.brightness_source == 'sysfs' else ''
            ),
            'dim_available': self.brightness_source is not None,
            'busy': False,
            'errors': [],
        }


def make_machine(
        values=None,
        driver=None,
        clock=None,
        factory=None,
        publish=None):
    driver = driver or FakeDriver()
    clock = clock or FakeClock()
    factory = factory or TimerFactory()
    config = FakeConfig(values)
    machine = DisplayStateMachine(
        config,
        driver,
        publish=publish,
        clock=clock,
        timer_factory=factory,
    )
    return machine, config, driver, clock, factory


def display_values(**values):
    return {'display': dict(values)}


def test_default_dim_after_2min():
    machine, _, driver, clock, factory = make_machine()
    dim_timer, standby_timer = factory.timers

    assert dim_timer.starts[-1] == 120
    assert standby_timer.starts[-1] == 300

    clock.advance(120)
    dim_timer.fire()

    assert machine.get_status()['state'] == STATE_DIMMED
    assert driver.percents == [10]


def test_default_standby_after_5min():
    machine, _, driver, clock, factory = make_machine()
    dim_timer, standby_timer = factory.timers

    clock.advance(300)
    standby_timer.fire()

    status = machine.get_status()
    assert status['state'] == STATE_STANDBY
    assert status['power'] is False
    assert driver.powers == [False]
    assert dim_timer.cancel_count >= 1


def test_interaction_restores_brightness():
    driver = FakeDriver(mechanic='power_off')
    machine, _, driver, clock, factory = make_machine(driver=driver)
    _, standby_timer = factory.timers

    clock.advance(300)
    standby_timer.fire()
    assert machine.get_status()['state'] == STATE_STANDBY

    machine.interaction()

    status = machine.get_status()
    assert status['state'] == STATE_ACTIVE
    assert driver.powers == [False, True]
    assert driver.percents == [100]
    assert factory.timers[0].starts[-1] == 120
    assert factory.timers[1].starts[-1] == 300


def test_both_zero_disables_timers():
    machine, _, driver, clock, factory = make_machine(
        display_values(dim_timeout_min=0, standby_timeout_min=0),
    )

    assert all(not timer.starts for timer in factory.timers)
    assert all(timer.cancel_count >= 1 for timer in factory.timers)
    clock.advance(600)

    assert machine.get_status()['state'] == STATE_ACTIVE
    assert driver.powers == []


def test_standby_before_dim_rejected():
    machine, config, _, _, _ = make_machine()

    with pytest.raises(ValueError):
        machine.set_timeouts(5, 2)

    assert 'standby_timeout_min' not in config.values.get('display', {})

    machine.set_timeouts(2, 0)
    assert config.values['display']['standby_timeout_min'] == 0


def test_invalid_standby_is_raised_to_dim_timeout():
    machine, _, _, _, _ = make_machine(
        display_values(dim_timeout_min=2, standby_timeout_min=1),
    )

    assert machine.get_status()['standby_timeout_min'] == 2


def test_music_on_while_playing_suppresses_transitions():
    machine, _, driver, clock, factory = make_machine(
        display_values(music_mode='on_while_playing'),
    )
    dim_timer, standby_timer = factory.timers

    machine.on_player_state('play')
    clock.advance(120)
    dim_timer.fire()
    assert machine.get_status()['state'] == STATE_ACTIVE

    clock.advance(180)
    standby_timer.fire()
    assert machine.get_status()['state'] == STATE_ACTIVE

    machine.on_player_state('pause')
    assert machine.get_status()['state'] == STATE_STANDBY
    assert driver.powers == [False]


def test_music_dim_while_playing_allows_dim_only():
    machine, _, driver, clock, factory = make_machine(
        display_values(music_mode='dim_while_playing'),
    )
    dim_timer, standby_timer = factory.timers

    machine.on_player_state('play')
    clock.advance(120)
    dim_timer.fire()
    assert machine.get_status()['state'] == STATE_DIMMED

    clock.advance(180)
    standby_timer.fire()
    assert machine.get_status()['state'] == STATE_DIMMED

    machine.on_player_state('pause')
    assert machine.get_status()['state'] == STATE_STANDBY
    assert driver.powers == [False]


def test_music_normal_does_not_suppress():
    machine, _, _, clock, factory = make_machine()
    dim_timer, standby_timer = factory.timers

    machine.on_player_state('play')
    clock.advance(120)
    dim_timer.fire()
    assert machine.get_status()['state'] == STATE_DIMMED

    clock.advance(180)
    standby_timer.fire()
    assert machine.get_status()['state'] == STATE_STANDBY


def test_music_wakes_from_standby_without_resetting_deadline():
    driver = FakeDriver(mechanic='power_off')
    machine, _, driver, clock, factory = make_machine(
        display_values(music_mode='on_while_playing'),
        driver=driver,
    )
    _, standby_timer = factory.timers

    clock.advance(300)
    standby_timer.fire()
    assert machine.get_status()['state'] == STATE_STANDBY

    machine.on_player_state('play')
    assert machine.get_status()['state'] == STATE_ACTIVE
    assert driver.powers == [False, True]

    machine.on_player_state('pause')
    assert machine.get_status()['state'] == STATE_STANDBY
    assert driver.powers == [False, True, False]


def test_set_power_suppression_window():
    driver = FakeDriver(mechanic='power_off')
    machine, _, driver, clock, _ = make_machine(driver=driver)

    machine.set_power(False)
    assert machine.get_status()['state'] == STATE_STANDBY

    clock.advance(0.5)
    machine.interaction()
    assert machine.get_status()['state'] == STATE_STANDBY

    clock.advance(0.6)
    machine.interaction()
    assert machine.get_status()['state'] == STATE_ACTIVE
    assert driver.powers == [False, True]


def test_setter_persists_values():
    machine, config, driver, _, _ = make_machine()

    machine.set_brightness(50)
    machine.set_dim_brightness(20)
    machine.set_timeouts(1, 2)
    machine.set_music_mode('on_while_playing')
    machine.set_standby_mechanic('power_off')

    display = config.values['display']
    assert display['brightness'] == 50
    assert display['dim_brightness'] == 20
    assert display['dim_timeout_min'] == 1
    assert display['standby_timeout_min'] == 2
    assert display['music_mode'] == 'on_while_playing'
    assert display['standby_mechanic'] == 'power_off'
    assert driver.percents[-1] == 50
    assert driver.mechanic == 'power_off'
    assert all(saved for saved in config.saved)


def test_setter_rolls_back_on_save_error():
    machine, config, driver, _, _ = make_machine()
    config.fail_save = True

    with pytest.raises(RuntimeError, match='config_save_failed'):
        machine.set_brightness(50)

    assert machine.get_status()['brightness_percent'] == 100
    assert driver.percents == []
    assert config.values['display']['brightness'] is None

    with pytest.raises(RuntimeError, match='config_save_failed'):
        machine.set_timeouts(1, 2)

    assert machine.get_status()['dim_timeout_min'] == 2
    assert machine.get_status()['standby_timeout_min'] == 5


def test_validation_rejects_invalid_values():
    machine, _, driver, _, _ = make_machine()

    for value in (0, 101, True, '50'):
        with pytest.raises(ValueError):
            machine.set_brightness(value)

    assert machine.set_dim_brightness(0) is None
    with pytest.raises(ValueError):
        machine.set_dim_brightness(101)

    with pytest.raises(ValueError):
        machine.set_timeouts(-1, 0)
    with pytest.raises(ValueError):
        machine.set_timeouts(0, 1441)
    with pytest.raises(ValueError):
        machine.set_music_mode('bogus')
    with pytest.raises(ValueError):
        machine.set_standby_mechanic('bogus')
    with pytest.raises(ValueError):
        machine.set_power(1)

    assert driver.powers == []


def test_no_display_control_rejects_setters():
    driver = FakeDriver(
        brightness_source=None,
        power_path=None,
        mechanic=None,
    )
    machine, _, _, _, _ = make_machine(driver=driver)

    for call in (
            lambda: machine.set_brightness(50),
            lambda: machine.set_dim_brightness(10),
            lambda: machine.set_timeouts(1, 2),
            lambda: machine.set_music_mode('normal'),
            lambda: machine.set_standby_mechanic('auto'),
            lambda: machine.set_power(True)):
        with pytest.raises(RuntimeError, match='no_display_control'):
            call()


def test_power_only_rejects_brightness():
    driver = FakeDriver(
        brightness_source=None,
        power_path='vcgencmd',
        mechanic='power_off',
    )
    machine, _, driver, _, _ = make_machine(driver=driver)

    with pytest.raises(RuntimeError, match='no_display_control'):
        machine.set_brightness(50)

    machine.set_power(False)
    assert driver.powers == [False]


def test_timeouts_are_absolute_deadlines():
    machine, _, _, clock, factory = make_machine()
    dim_timer, standby_timer = factory.timers

    clock.advance(30)
    machine.set_timeouts(2, 5)

    assert dim_timer.starts[-1] == 90
    assert standby_timer.starts[-1] == 270

    machine.interaction()
    assert dim_timer.starts[-1] == 120
    assert standby_timer.starts[-1] == 300


def test_status_contract():
    machine, _, driver, _, _ = make_machine()

    status = machine.get_status()
    assert status['state'] == STATE_ACTIVE
    assert status['power'] is True
    assert status['brightness_percent'] == 100
    assert status['dim_brightness_percent'] == 10
    assert status['dim_timeout_min'] == 2
    assert status['standby_timeout_min'] == 5
    assert status['music_mode'] == 'normal'
    assert status['standby_mechanic'] == 'auto'
    assert status['standby_mechanic_active'] == 'backlight'
    assert status['brightness_source'] == 'sysfs'
    assert status['dim_available'] is True

    machine.set_power(False)
    status = machine.get_status()
    assert status['state'] == STATE_STANDBY
    assert status['power'] is False

    machine.set_power(True)
    status = machine.get_status()
    assert status['state'] == STATE_ACTIVE
    assert status['power'] is True


def test_close_cancels_timers():
    machine, _, _, _, factory = make_machine()

    machine.close()

    assert all(timer.cancel_count >= 1 for timer in factory.timers)
