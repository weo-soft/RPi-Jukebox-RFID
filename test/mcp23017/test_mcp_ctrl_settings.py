"""Settings RPC and learn-mode tests for the MCP23017 control object."""

import pytest
import jukebox.cfghandler as cfghandler

from components.gpio.mcp23017.config import parse_config
from components.gpio.mcp23017.ctrl import Ctrl
from components.rpc_command_alias import cmd_alias_definitions
from mcp23017_fakes import FakeBackend, FakeBinder, FakeClock, Recorder

NO_BOOT_CONFIG = ('/nonexistent/config.txt',)

CONFIG = """bus: 1
address: 0x20
chip: 2
poll_interval_ms: 25
buttons:
  play_pause:
    pin: GPA0
    type: momentary
    debounce_ms: 30
    actions:
      on_press:
        alias: toggle
  previous:
    pin: GPA2
    type: momentary
    debounce_ms: 30
    actions:
      on_press:
        alias: prev_song
  volume_up:
    pin: GPA3
    type: hold_repeat
    debounce_ms: 30
    hold_ms: 500
    actions:
      on_press:
        alias: change_volume
        args: [2]
"""


def make_ctrl(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text(CONFIG, encoding='utf-8')

    def load():
        handler = cfghandler.ConfigHandler('mcp-settings-test')
        cfghandler.load_yaml(handler, str(path))
        return parse_config(handler)

    clock = FakeClock()
    recorder = Recorder()
    backend = FakeBackend(gppu=0x0d)
    ctrl = Ctrl(clock=clock, boot_config_paths=NO_BOOT_CONFIG,
                config_path=str(path), reload_config=load,
                binder=FakeBinder(recorder))
    config = load()
    ctrl.mark_enabled()
    ctrl.load_config(config)
    ctrl.resolve_actions(cmd_alias_definitions)
    ctrl.attach(config, backend, 2)
    return ctrl, clock, recorder, backend, path


def test_get_button_settings_lists_all_pins(tmp_path):
    ctrl, _, _, _, _ = make_ctrl(tmp_path)
    settings = ctrl.get_button_settings()
    assert settings['state'] == 'running'
    assert len(settings['actions']) == 8
    assert len(settings['pins']) == 16
    pins = {entry['pin']: entry for entry in settings['pins']}
    assert pins[0]['action_id'] == 'play_pause'
    assert pins[0]['assigned'] is True
    assert pins[2]['action_id'] == 'previous'
    assert pins[3]['action_id'] == 'volume_up'
    assert pins[1]['assigned'] is False
    assert pins[15]['name'] == 'GPB7'


def test_set_button_applies_the_configuration_live(tmp_path):
    ctrl, _, _, backend, path = make_ctrl(tmp_path)
    settings = ctrl.set_button(6, 'volume_up')
    pins = {entry['pin']: entry for entry in settings['pins']}
    assert pins[6]['action_id'] == 'volume_up'
    assert pins[6]['type'] == 'hold_repeat'
    assert settings['pins'][6]['button'] == 'volume_up_2'
    assert ctrl.get_status()['gppu_mask'] == 0x4d
    assert backend.writes[-1] == 0x4d
    assert 'GPA6' in path.read_text(encoding='utf-8')


def test_set_button_keeps_the_name_of_an_assigned_pin(tmp_path):
    ctrl, _, _, _, _ = make_ctrl(tmp_path)
    settings = ctrl.set_button(0, 'next')
    pins = {entry['pin']: entry for entry in settings['pins']}
    assert pins[0]['button'] == 'play_pause'
    assert pins[0]['action_id'] == 'next'
    assert pins[0]['type'] == 'momentary'


def test_clear_button_removes_the_assignment(tmp_path):
    ctrl, _, _, backend, _ = make_ctrl(tmp_path)
    settings = ctrl.clear_button(3)
    pins = {entry['pin']: entry for entry in settings['pins']}
    assert pins[3]['assigned'] is False
    assert ctrl.get_status()['gppu_mask'] == 0x05
    assert backend.writes[-1] == 0x05


def test_set_button_rejects_unknown_actions_and_pins(tmp_path):
    ctrl, _, _, _, _ = make_ctrl(tmp_path)
    with pytest.raises(ValueError):
        ctrl.set_button(1, 'does_not_exist')
    with pytest.raises(ValueError):
        ctrl.set_button(16, 'next')


def test_settings_require_a_running_plugin():
    ctrl = Ctrl()
    with pytest.raises(RuntimeError):
        ctrl.set_button(0, 'next')


def test_learn_detects_the_pressed_pin(tmp_path):
    ctrl, clock, recorder, backend, _ = make_ctrl(tmp_path)
    state = ctrl.start_learn('next')
    assert state['state'] == 'waiting'
    assert backend.writes[-1] == 0xffff

    backend.values[7] = 0
    ctrl.poll_once(clock())
    clock.advance(0.1)
    ctrl.poll_once(clock())

    state = ctrl.get_learn_state()
    assert state['state'] == 'learned'
    assert state['pin'] == 7
    assert backend.writes[-1] == 0x0d
    assert recorder.calls == []
    assert ctrl.cancel_learn()['state'] == 'idle'


def test_learn_times_out_and_restores_the_mask(tmp_path):
    ctrl, clock, _, backend, _ = make_ctrl(tmp_path)
    ctrl.start_learn('next')
    clock.advance(16)
    ctrl.poll_once(clock())
    state = ctrl.get_learn_state()
    assert state['state'] == 'timeout'
    assert backend.writes[-1] == 0x0d


def test_learn_does_not_execute_the_assigned_button(tmp_path):
    ctrl, clock, recorder, backend, _ = make_ctrl(tmp_path)
    ctrl.start_learn('next')
    backend.values[0] = 0
    ctrl.poll_once(clock())
    clock.advance(0.1)
    ctrl.poll_once(clock())
    assert ctrl.get_learn_state()['pin'] == 0
    assert recorder.calls == []


def test_cancel_learn_restores_the_mask(tmp_path):
    ctrl, _, _, backend, _ = make_ctrl(tmp_path)
    ctrl.start_learn('volume_up')
    assert backend.writes[-1] == 0xffff
    ctrl.cancel_learn()
    assert backend.writes[-1] == 0x0d
    assert ctrl.get_learn_state()['state'] == 'idle'


def test_learned_press_does_not_fire_the_old_action(tmp_path):
    ctrl, clock, recorder, backend, _ = make_ctrl(tmp_path)
    ctrl.start_learn('next')
    backend.values[0] = 0
    ctrl.poll_once(clock())
    clock.advance(0.1)
    ctrl.poll_once(clock())
    assert ctrl.get_learn_state()['state'] == 'learned'
    # The button is still held while the settings page consumes the result.
    backend.values[0] = 0
    clock.advance(0.1)
    ctrl.poll_once(clock())
    assert recorder.calls == []
