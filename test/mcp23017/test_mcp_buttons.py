"""Debounce and state machine tests for the MCP23017 buttons."""

import pytest

from components.gpio.mcp23017.buttons import ButtonController
from mcp23017_fakes import FakeBackend, FakeClock, Recorder, make_config


def config_text(button_type='momentary', action_keys=('on_press',), hold_ms=None,
                active_low=True):
    hold = f'\n    hold_ms: {hold_ms}' if hold_ms is not None else ''
    actions = '\n'.join(f'      {key}:\n        alias: toggle' for key in action_keys)
    pull_up = 'internal' if active_low else 'external'
    return f"""
bus: 1
address: 0x20
poll_interval_ms: 25
buttons:
  b1:
    pin: GPA0
    type: {button_type}
    active_low: {str(active_low).lower()}
    pull_up: {pull_up}
    debounce_ms: 30{hold}
    actions:
{actions}
"""


class Rig:
    def __init__(self, text):
        self.config = make_config(text)
        self.clock = FakeClock()
        self.backend = FakeBackend()
        self.recorder = Recorder()
        self.bindings = {
            button.name: {key: self.recorder.action(f'{button.name}.{key}')
                          for key in button.actions}
            for button in self.config.buttons if button.valid
        }
        self.controller = ButtonController(self.config.buttons, self.backend.read_pin,
                                           self.bindings, self.clock)

    def poll(self):
        self.controller.poll(self.clock())

    def settle(self, value, wait=0.031):
        self.backend.values[0] = value
        self.poll()
        self.clock.advance(wait)
        self.poll()

    def held(self, line=0):
        return self.backend.values.get(line, 1)


def test_momentary_fires_once_per_press():
    rig = Rig(config_text())
    rig.settle(1)
    rig.settle(0)
    assert rig.recorder.calls == ['b1.on_press']
    rig.poll()
    rig.clock.advance(0.1)
    rig.poll()
    assert rig.recorder.calls == ['b1.on_press']
    rig.settle(1)
    rig.settle(0)
    assert rig.recorder.calls == ['b1.on_press', 'b1.on_press']


def test_start_state_does_not_fire():
    rig = Rig(config_text())
    rig.settle(0)
    rig.clock.advance(1.0)
    rig.poll()
    assert rig.recorder.calls == []
    rig.settle(1)
    assert rig.recorder.calls == []
    rig.settle(0)
    assert rig.recorder.calls == ['b1.on_press']


def test_short_bounce_is_ignored():
    rig = Rig(config_text())
    rig.settle(1)
    rig.backend.values[0] = 0
    rig.poll()
    rig.clock.advance(0.010)
    rig.poll()
    rig.backend.values[0] = 1
    rig.poll()
    rig.clock.advance(0.031)
    rig.poll()
    assert rig.recorder.calls == []


def test_active_high_polarity():
    rig = Rig(config_text(active_low=False))
    rig.settle(0)
    rig.settle(1)
    assert rig.recorder.calls == ['b1.on_press']
    rig.settle(0)
    assert rig.recorder.calls == ['b1.on_press']


def test_long_press_fires_after_hold_time():
    rig = Rig(config_text('long_press', ('on_long_press',), hold_ms=500))
    rig.settle(1)
    rig.settle(0)
    assert rig.recorder.calls == []
    rig.clock.advance(0.4)
    rig.poll()
    assert rig.recorder.calls == []
    rig.clock.advance(0.1)
    rig.poll()
    assert rig.recorder.calls == ['b1.on_long_press']
    rig.clock.advance(1.0)
    rig.poll()
    assert rig.recorder.calls == ['b1.on_long_press']


def test_long_press_release_before_hold_does_nothing():
    rig = Rig(config_text('long_press', ('on_long_press',), hold_ms=500))
    rig.settle(1)
    rig.settle(0)
    rig.settle(1)
    rig.clock.advance(1.0)
    rig.poll()
    assert rig.recorder.calls == []


def test_short_long_press_short_action():
    rig = Rig(config_text('short_long_press', ('on_short_press', 'on_long_press'),
                          hold_ms=500))
    rig.settle(1)
    rig.settle(0)
    rig.settle(1)
    assert rig.recorder.calls == ['b1.on_short_press']


def test_short_long_press_long_action():
    rig = Rig(config_text('short_long_press', ('on_short_press', 'on_long_press'),
                          hold_ms=500))
    rig.settle(1)
    rig.settle(0)
    rig.clock.advance(0.5)
    rig.poll()
    assert rig.recorder.calls == ['b1.on_long_press']
    rig.settle(1)
    assert rig.recorder.calls == ['b1.on_long_press']


def test_hold_repeat_fires_immediately_and_repeats():
    rig = Rig(config_text('hold_repeat', ('on_press',), hold_ms=500))
    rig.settle(1)
    rig.settle(0)
    assert rig.recorder.calls == ['b1.on_press']
    rig.clock.advance(0.5)
    rig.poll()
    assert rig.recorder.calls == ['b1.on_press', 'b1.on_press']
    rig.clock.advance(0.5)
    rig.poll()
    assert len(rig.recorder.calls) == 3
    rig.settle(1)
    rig.clock.advance(2.0)
    rig.poll()
    assert len(rig.recorder.calls) == 3


def test_action_errors_do_not_stop_polling():
    rig = Rig(config_text())

    def failing():
        raise RuntimeError('action failed')

    rig.bindings['b1']['on_press'] = failing
    rig.settle(1)
    rig.settle(0)
    rig.settle(1)
    rig.settle(0)
    assert rig.controller.states['b1'] == 'pressed'


def test_invalid_buttons_are_not_read():
    text = config_text().replace('debounce_ms: 30', 'debounce_ms: 10')
    config = make_config(text)
    backend = FakeBackend()
    backend.read_error = AssertionError('must not be read')
    controller = ButtonController(config.buttons, backend.read_pin, {}, FakeClock())
    controller.poll(0.0)
    assert controller.states == {}


@pytest.mark.parametrize('button_type,key,hold_ms', [
    ('momentary', 'on_press', None),
    ('hold_repeat', 'on_press', 500),
])
def test_hold_features_do_not_fire_without_a_hold(button_type, key, hold_ms):
    rig = Rig(config_text(button_type, (key,), hold_ms=hold_ms))
    rig.settle(1)
    assert rig.recorder.calls == []
