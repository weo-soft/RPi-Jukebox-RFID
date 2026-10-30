"""RPC surface and status tests for the MCP23017 control object."""

import pytest

from components.gpio.mcp23017.ctrl import Ctrl, read_overlay
from components.rpc_command_alias import cmd_alias_definitions
from mcp23017_fakes import (
    FakeBackend,
    FakeBinder,
    FakeClock,
    Recorder,
    make_config,
)

CONFIG = """
bus: 1
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
  volume_up:
    pin: GPA1
    type: hold_repeat
    debounce_ms: 30
    hold_ms: 500
    actions:
      on_press:
        alias: change_volume
        args: [2]
  power:
    pin: GPA2
    type: momentary
    debounce_ms: 30
    actions:
      on_press:
        alias: shutdown
  external:
    pin: GPA3
    type: momentary
    pull_up: external
    debounce_ms: 30
    actions:
      on_press:
        alias: reboot
"""

NO_BOOT_CONFIG = ('/nonexistent/config.txt',)


def make_ctrl(tmp_path, text=CONFIG):
    ctrl = Ctrl(clock=FakeClock(), boot_config_paths=NO_BOOT_CONFIG)
    config = make_config(text)
    recorder = Recorder()
    backend = FakeBackend(gppu=0x0f)
    ctrl.mark_enabled()
    ctrl.load_config(config)
    ctrl.resolve_actions(cmd_alias_definitions)
    ctrl.attach(config, backend, 2)
    ctrl.bind_actions(FakeBinder(recorder))
    return ctrl, config, recorder, backend


def test_disabled_status():
    ctrl = Ctrl(clock=FakeClock(), boot_config_paths=NO_BOOT_CONFIG)
    status = ctrl.get_status()
    assert status['enabled'] is False
    assert status['state'] == 'disabled'
    assert status['bus'] is None
    assert status['address'] is None
    assert status['gpiochip'] is None
    assert status['gppu_mask'] == 0
    assert status['gppu_readback'] is None
    assert status['buttons'] == []
    assert status['last_error'] is None


def test_error_status_keeps_known_values(tmp_path):
    ctrl, config, _, _ = make_ctrl(tmp_path)
    ctrl.mark_error('BackendError: boom')
    status = ctrl.get_status()
    assert status['state'] == 'error'
    assert status['enabled'] is True
    assert status['bus'] == 1
    assert status['address'] == '0x20'
    assert status['last_error'] == 'BackendError: boom'
    assert len(status['buttons']) == 4
    assert status['gppu_mask'] == 0x07


def test_running_status(tmp_path):
    ctrl, _, _, backend = make_ctrl(tmp_path)
    status = ctrl.get_status()
    assert status['enabled'] is True
    assert status['state'] == 'running'
    assert status['bus'] == 1
    assert status['address'] == '0x20'
    assert status['gpiochip'] == 2
    assert status['poll_interval_ms'] == 25
    assert status['gppu_mask'] == 0x07
    assert status['gppu_readback'] == 0x0f
    assert status['last_error'] is None
    assert status['overlay'] is None
    assert [button['name'] for button in status['buttons']] == [
        'play_pause', 'volume_up', 'power', 'external']
    assert all(button['state'] == 'idle' for button in status['buttons'])
    assert all(button['valid'] for button in status['buttons'])


def test_list_buttons_targets(tmp_path):
    ctrl, _, _, _ = make_ctrl(tmp_path)
    buttons = {entry['name']: entry for entry in ctrl.list_buttons()}
    assert buttons['play_pause']['actions']['on_press'] == {
        'source': 'alias',
        'target': {
            'package': 'player',
            'plugin': 'ctrl',
            'method': 'toggle',
            'args': [],
            'kwargs': {},
        },
    }
    assert buttons['volume_up']['actions']['on_press']['target']['args'] == [2]
    assert buttons['volume_up']['actions']['on_press']['target']['package'] == 'volume'


def test_test_button_simulates_by_default(tmp_path):
    ctrl, _, recorder, _ = make_ctrl(tmp_path)
    result = ctrl.test_button('play_pause')
    assert result['button'] == 'play_pause'
    assert result['pin'] == 0
    assert result['value'] == 1
    assert result['executed'] is False
    assert result['blocked'] is False
    assert result['result'] is None
    assert result['target']['package'] == 'player'
    assert recorder.calls == []


def test_test_button_executes_when_requested(tmp_path):
    ctrl, _, recorder, backend = make_ctrl(tmp_path)
    backend.values[0] = 0
    result = ctrl.test_button('play_pause', execute=True)
    assert result['executed'] is True
    assert result['value'] == 0
    assert recorder.calls == ['player.ctrl.toggle']


def test_test_button_blocks_power_actions(tmp_path):
    ctrl, _, recorder, _ = make_ctrl(tmp_path)
    result = ctrl.test_button('power', execute=True)
    assert result['executed'] is False
    assert result['blocked'] is True
    assert recorder.calls == []
    result = ctrl.test_button('power', execute=True, force=True)
    assert result['executed'] is True
    assert result['blocked'] is False
    assert recorder.calls == ['host.shutdown.None']


def test_test_button_rejects_unknown_names(tmp_path):
    ctrl, _, _, _ = make_ctrl(tmp_path)
    with pytest.raises(ValueError):
        ctrl.test_button('does_not_exist')


def test_test_button_requires_a_running_plugin():
    ctrl = Ctrl(clock=FakeClock(), boot_config_paths=NO_BOOT_CONFIG)
    with pytest.raises(RuntimeError):
        ctrl.test_button('play_pause')


def test_unknown_alias_marks_button_invalid(tmp_path):
    text = CONFIG.replace('alias: toggle', 'alias: does_not_exist')
    ctrl, config, _, _ = make_ctrl(tmp_path, text)
    button = config.buttons[0]
    assert button.valid is False
    assert 'unknown RPC alias' in button.error
    assert ctrl.list_buttons()[0]['actions'] == {}
    with pytest.raises(RuntimeError):
        ctrl.test_button('play_pause')


def test_overlay_matching(tmp_path):
    boot = tmp_path / 'config.txt'
    boot.write_text('# comment\n'
                    'dtoverlay=mcp23017,addr=0x20,noints,i2c1\n', encoding='utf-8')
    config = make_config(CONFIG)
    overlay = read_overlay(config, (str(boot),))
    assert overlay == {
        'path': str(boot),
        'line': 2,
        'address': '0x20',
        'bus': 1,
        'noints': True,
        'match': True,
    }
    other = make_config(CONFIG.replace('address: 0x20', 'address: 0x21'))
    assert read_overlay(other, (str(boot),))['match'] is False


def test_overlay_missing_line(tmp_path):
    boot = tmp_path / 'config.txt'
    boot.write_text('dtparam=i2c_arm=on\n', encoding='utf-8')
    assert read_overlay(make_config(CONFIG), (str(boot),)) is None


def test_overlay_without_file():
    assert read_overlay(make_config(CONFIG), (str('/nonexistent/config.txt'),)) is None


def test_gppu_mask_skips_external_and_invalid_buttons(tmp_path):
    ctrl, _, _, _ = make_ctrl(tmp_path)
    assert ctrl.get_status()['gppu_mask'] == 0x07
