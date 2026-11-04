"""Tests for the display interaction monitor."""

import importlib.util
import sys
from pathlib import Path

import evdev


sys.path.insert(0, str(Path(__file__).parents[2] / 'src/jukebox'))

MODULE_PATH = (
    Path(__file__).parents[2]
    / 'src/jukebox/components/display/activity.py'
)
SPEC = importlib.util.spec_from_file_location(
    'display_activity_under_test',
    MODULE_PATH,
)
activity = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(activity)


class FakeClock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class FakeStateMachine:
    def __init__(self):
        self.interactions = 0
        self.player_states = []

    def interaction(self):
        self.interactions += 1

    def on_player_state(self, state):
        self.player_states.append(state)


class FakeEvent:
    def __init__(self, event_type, code, value):
        self.type = event_type
        self.code = code
        self.value = value


class FakeDevice:
    def __init__(self, name='device', capabilities=None):
        self.name = name
        self._capabilities = capabilities or {}
        self.closed = False

    def capabilities(self):
        return self._capabilities

    def close(self):
        self.closed = True


class FakeListener:
    def __init__(self, name, exact, thread_name):
        self.name = name
        self.exact = exact
        self.thread_name = thread_name
        self.button_callbacks = {}
        self.started = False
        self.stopped = False

    def start(self):
        self.started = True

    def stop(self):
        self.stopped = True

    def is_alive(self):
        return self.started and not self.stopped


class FakeSocket:
    def __init__(self):
        self.closed = False

    def close(self, linger=0):
        self.closed = True


class FakeSubscriber:
    def __init__(self):
        self.socket = FakeSocket()


def make_monitor(
        state_machine=None,
        clock=None,
        input_device_factory=None,
        key_listener_factory=None):
    kwargs = {'clock': clock or FakeClock()}
    if input_device_factory is not None:
        kwargs['input_device_factory'] = input_device_factory
    if key_listener_factory is not None:
        kwargs['key_listener_factory'] = key_listener_factory
    return activity.ActivityMonitor(
        state_machine or FakeStateMachine(),
        **kwargs,
    )


def test_interaction_throttles_to_one_per_second():
    clock = FakeClock()
    state_machine = FakeStateMachine()
    monitor = make_monitor(state_machine, clock)

    monitor.interaction()
    monitor.interaction()
    assert state_machine.interactions == 1

    clock.advance(1.0)
    monitor.interaction()
    assert state_machine.interactions == 2


def test_rfid_scan_is_an_interaction():
    state_machine = FakeStateMachine()
    monitor = make_monitor(state_machine)

    monitor._dispatch('rfid.card_id', {})
    assert state_machine.interactions == 1

    monitor._dispatch('reader.card_id', {})
    assert state_machine.interactions == 1


def test_player_status_is_not_an_interaction():
    state_machine = FakeStateMachine()
    monitor = make_monitor(state_machine)

    monitor._dispatch('playerstatus', {'state': 'play'})
    monitor._dispatch('playerstatus', {'state': 'pause'})

    assert state_machine.interactions == 0
    assert state_machine.player_states == ['play', 'pause']


def test_player_status_revocation_is_ignored():
    state_machine = FakeStateMachine()
    monitor = make_monitor(state_machine)

    monitor._dispatch('playerstatus', '')
    monitor._dispatch('playerstatus', {'state': 42})

    assert state_machine.player_states == []


def test_touch_btn_touch_flank_resets_timer():
    clock = FakeClock()
    state_machine = FakeStateMachine()
    monitor = make_monitor(state_machine, clock)
    down = FakeEvent(evdev.ecodes.EV_KEY, evdev.ecodes.BTN_TOUCH, 1)
    up = FakeEvent(evdev.ecodes.EV_KEY, evdev.ecodes.BTN_TOUCH, 0)

    monitor._handle_touch_event(down)
    monitor._handle_touch_event(down)
    assert state_machine.interactions == 1

    monitor._handle_touch_event(up)
    clock.advance(1.0)
    monitor._handle_touch_event(down)
    assert state_machine.interactions == 2


def test_touch_tracking_id_flank_resets_timer():
    clock = FakeClock()
    state_machine = FakeStateMachine()
    monitor = make_monitor(state_machine, clock)

    monitor._handle_touch_event(FakeEvent(
        evdev.ecodes.EV_ABS,
        evdev.ecodes.ABS_MT_TRACKING_ID,
        -1,
    ))
    monitor._handle_touch_event(FakeEvent(
        evdev.ecodes.EV_ABS,
        evdev.ecodes.ABS_MT_TRACKING_ID,
        5,
    ))
    monitor._handle_touch_event(FakeEvent(
        evdev.ecodes.EV_ABS,
        evdev.ecodes.ABS_MT_TRACKING_ID,
        -1,
    ))
    clock.advance(1.0)
    monitor._handle_touch_event(FakeEvent(
        evdev.ecodes.EV_ABS,
        evdev.ecodes.ABS_MT_TRACKING_ID,
        6,
    ))

    assert state_machine.interactions == 2


def test_touch_detection_uses_abs_axes():
    touch = FakeDevice(capabilities={
        evdev.ecodes.EV_ABS: [
            (evdev.ecodes.ABS_X, None),
            (evdev.ecodes.ABS_Y, None),
        ],
    })
    keyboard = FakeDevice(capabilities={
        evdev.ecodes.EV_KEY: [evdev.ecodes.KEY_PLAYPAUSE],
    })

    assert activity.ActivityMonitor._is_touch_device(touch) is True
    assert activity.ActivityMonitor._is_touch_device(keyboard) is False


def test_configured_touch_name_limits_selection():
    monitor = make_monitor()
    monitor._touch_device_name = 'WaveShare'
    touch = FakeDevice(
        name='WaveShare WS170120',
        capabilities={evdev.ecodes.EV_ABS: [(evdev.ecodes.ABS_X, None)]},
    )
    other = FakeDevice(
        name='Other Touch',
        capabilities={evdev.ecodes.EV_ABS: [(evdev.ecodes.ABS_X, None)]},
    )

    assert monitor._matches_touch(touch) is True
    assert monitor._matches_touch(other) is False


def test_key_codes_and_button_listener(monkeypatch):
    device = FakeDevice(capabilities={
        evdev.ecodes.EV_KEY: [
            evdev.ecodes.KEY_PLAYPAUSE,
            evdev.ecodes.KEY_VOLUMEUP,
        ],
    })
    monkeypatch.setattr(activity, 'find_device', lambda name, exact_name: '/dev/input/event1')
    monitor = make_monitor(
        input_device_factory=lambda path: device,
        key_listener_factory=FakeListener,
    )
    monitor._button_devices = ['188A']

    assert monitor._key_codes('188A') == [
        evdev.ecodes.KEY_PLAYPAUSE,
        evdev.ecodes.KEY_VOLUMEUP,
    ]

    monitor._start_buttons()
    assert len(monitor._button_listeners) == 1
    listener = monitor._button_listeners[0]
    assert listener.started is True
    assert listener.button_callbacks[evdev.ecodes.KEY_PLAYPAUSE] == monitor.interaction


def test_button_device_without_permission_sets_error(monkeypatch):
    def deny(path):
        raise PermissionError('denied')

    monkeypatch.setattr(activity, 'find_device', lambda name, exact_name: '/dev/input/event1')
    monitor = make_monitor(input_device_factory=deny)
    monitor._button_devices = ['188A']

    monitor._start_buttons()

    assert activity.ERROR_NO_INPUT in monitor.errors
    assert monitor._button_listeners == []


def test_touch_without_permission_sets_error(monkeypatch):
    monkeypatch.setattr(activity.evdev, 'list_devices', lambda: ['/dev/input/event0'])

    def deny(path):
        raise PermissionError('denied')

    monitor = make_monitor(input_device_factory=deny)
    monitor._start_touch()

    assert activity.ERROR_NO_INPUT in monitor.errors
    assert monitor._touch_device is None


def test_configured_touch_device_not_found():
    monitor = make_monitor()
    monitor._touch_device_name = 'WaveShare'
    monitor._input_device_factory = lambda path: FakeDevice(
        name='Other Device',
        capabilities={evdev.ecodes.EV_ABS: [(evdev.ecodes.ABS_X, None)]},
    )

    assert monitor._open_touch_device() is None


def test_stop_closes_devices_and_listeners():
    monitor = make_monitor()
    subscriber = FakeSubscriber()
    touch = FakeDevice()
    listener = FakeListener('button', False, 'thread')
    listener.start()
    monitor._subscriber = subscriber
    monitor._touch_device = touch
    monitor._button_listeners = [listener]

    monitor.stop()

    assert subscriber.socket.closed is True
    assert touch.closed is True
    assert listener.stopped is True
    assert monitor._stopped.is_set()
