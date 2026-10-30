"""Configuration parsing and validation tests for the MCP23017 plugin."""

import pytest
import jukebox.cfghandler as cfghandler
from ruamel.yaml import YAML
from ruamel.yaml.constructor import DuplicateKeyError

from components.gpio.mcp23017.config import (
    ConfigError,
    parse_config,
    parse_pin,
    pin_name,
)
from mcp23017_fakes import make_config

BASE = """
bus: 1
address: 0x20
chip: auto
poll_interval_ms: 25
buttons:
  play_pause:
    pin: GPA0
    type: momentary
    active_low: true
    pull_up: internal
    debounce_ms: 30
    actions:
      on_press:
        alias: toggle
"""


def test_valid_configuration():
    config = make_config(BASE)
    assert config.bus == 1
    assert config.address == 0x20
    assert config.address_hex == '0x20'
    assert config.chip is None
    assert config.poll_interval_ms == 25
    assert config.gppu_mask == 0x01
    button = config.buttons[0]
    assert button.name == 'play_pause'
    assert button.pin == 0
    assert button.type == 'momentary'
    assert button.valid is True
    assert button.actions['on_press'].source == 'alias'


def test_address_accepts_integer_and_string():
    config = make_config(BASE.replace('address: 0x20', 'address: 32'))
    assert config.address == 0x20
    config = make_config(BASE.replace('address: 0x20', "address: '0x20'"))
    assert config.address == 0x20


def test_fixed_chip():
    config = make_config(BASE.replace('chip: auto', 'chip: 5'))
    assert config.chip == 5


@pytest.mark.parametrize('old,new', [
    ('bus: 1', 'bus: 7'),
    ('bus: 1', 'bus: -1'),
    ('address: 0x20', 'address: 0x1f'),
    ('address: 0x20', 'address: 0x28'),
    ('poll_interval_ms: 25', 'poll_interval_ms: 5'),
    ('poll_interval_ms: 25', 'poll_interval_ms: 2000'),
    ('chip: auto', 'chip: -1'),
])
def test_global_values_are_validated(old, new):
    with pytest.raises(ConfigError):
        make_config(BASE.replace(old, new))


def test_missing_buttons_is_a_global_error():
    with pytest.raises(ConfigError):
        make_config('bus: 1\naddress: 0x20\n')


@pytest.mark.parametrize('value,expected', [
    ('GPA0', 0),
    ('gpa7', 7),
    ('GPB0', 8),
    ('gpb7', 15),
    ('0', 0),
    ('15', 15),
    (3, 3),
])
def test_pin_parsing(value, expected):
    assert parse_pin(value) == expected


@pytest.mark.parametrize('value', ['GPC0', 'GPA8', '16', -1, 16, True, None, 'x'])
def test_invalid_pins(value):
    with pytest.raises(ConfigError):
        parse_pin(value)


def test_pin_names():
    assert pin_name(0) == 'GPA0'
    assert pin_name(7) == 'GPA7'
    assert pin_name(8) == 'GPB0'
    assert pin_name(15) == 'GPB7'


def test_duplicate_pin_marks_the_second_button_invalid():
    text = BASE + """
  next:
    pin: GPA0
    type: momentary
    debounce_ms: 30
    actions:
      on_press:
        alias: next_song
"""
    config = make_config(text)
    assert config.buttons[0].valid is True
    assert config.buttons[1].valid is False
    assert 'already used' in config.buttons[1].error


def test_debounce_shorter_than_poll_marks_button_invalid():
    config = make_config(BASE.replace('debounce_ms: 30', 'debounce_ms: 10'))
    assert config.buttons[0].valid is False
    assert 'poll interval' in config.buttons[0].error


@pytest.mark.parametrize('button_type,snippet', [
    ('long_press', 'on_long_press'),
    ('short_long_press', 'on_long_press'),
    ('hold_repeat', 'on_press'),
])
def test_hold_ms_is_required_for_hold_types(button_type, snippet):
    text = BASE.replace('type: momentary', f'type: {button_type}')
    text = text.replace('alias: toggle', 'alias: toggle')
    text = text.replace('on_press:', f'{snippet}:')
    text = text.replace('debounce_ms: 30', 'debounce_ms: 30')
    config = make_config(text)
    assert config.buttons[0].valid is False
    assert 'hold_ms' in config.buttons[0].error


def test_hold_ms_below_twice_the_poll_interval_is_invalid():
    text = BASE.replace('type: momentary', 'type: long_press')
    text = text.replace('on_press:', 'on_long_press:')
    text = text.replace('debounce_ms: 30', 'debounce_ms: 30\n    hold_ms: 40')
    config = make_config(text)
    assert config.buttons[0].valid is False
    assert 'twice the poll interval' in config.buttons[0].error


def test_valid_long_press():
    text = BASE.replace('type: momentary', 'type: long_press')
    text = text.replace('on_press:', 'on_long_press:')
    text = text.replace('debounce_ms: 30', 'debounce_ms: 30\n    hold_ms: 500')
    config = make_config(text)
    assert config.buttons[0].valid is True
    assert config.buttons[0].hold_ms == 500


def test_hold_ms_is_rejected_for_momentary():
    text = BASE.replace('debounce_ms: 30', 'debounce_ms: 30\n    hold_ms: 500')
    config = make_config(text)
    assert config.buttons[0].valid is False
    assert 'not used' in config.buttons[0].error


def test_internal_pull_up_requires_active_low():
    text = BASE.replace('active_low: true', 'active_low: false')
    config = make_config(text)
    assert config.buttons[0].valid is False
    assert 'active_low' in config.buttons[0].error


def test_unknown_button_key_is_rejected():
    text = BASE.replace('debounce_ms: 30', 'debounce: 30')
    config = make_config(text)
    assert config.buttons[0].valid is False
    assert 'unknown key' in config.buttons[0].error


def test_action_key_not_allowed_for_type():
    text = BASE.replace('on_press:', 'on_long_press:')
    config = make_config(text)
    assert config.buttons[0].valid is False
    assert "not allowed for type 'momentary'" in config.buttons[0].error


def test_short_long_press_accepts_one_action():
    text = BASE.replace('type: momentary', 'type: short_long_press')
    text = text.replace('on_press:', 'on_long_press:')
    text = text.replace('debounce_ms: 30', 'debounce_ms: 30\n    hold_ms: 500')
    config = make_config(text)
    assert config.buttons[0].valid is True
    assert 'on_long_press' in config.buttons[0].actions


def test_unknown_action_key_is_rejected():
    text = BASE.replace('alias: toggle', 'aliasy: toggle')
    config = make_config(text)
    assert config.buttons[0].valid is False
    assert 'unknown action key' in config.buttons[0].error


def test_scalar_args_are_normalized():
    text = BASE.replace('alias: toggle', 'alias: change_volume\n        args: 2')
    config = make_config(text)
    assert config.buttons[0].valid is True
    assert config.buttons[0].actions['on_press'].args == [2]


def test_alias_wins_over_full_rpc_fields():
    text = BASE.replace(
        'alias: toggle',
        'alias: toggle\n        package: player\n        plugin: ctrl\n        method: next',
    )
    config = make_config(text)
    button = config.buttons[0]
    assert button.valid is True
    assert button.actions['on_press'].source == 'alias'


def test_missing_actions_marks_button_invalid():
    text = BASE.replace("    actions:\n      on_press:\n        alias: toggle", '')
    config = make_config(text)
    assert config.buttons[0].valid is False
    assert 'actions' in config.buttons[0].error


def test_duplicate_yaml_keys_are_reported(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text(BASE + '  play_pause:\n    pin: GPA1\n', encoding='utf-8')
    handler = cfghandler.ConfigHandler('mcp23017-duplicate')
    with pytest.raises(DuplicateKeyError):
        cfghandler.load_yaml(handler, str(path))


def test_gppu_mask_ignores_invalid_buttons():
    text = BASE + """
  broken:
    pin: GPA1
    type: momentary
    debounce_ms: 10
    actions:
      on_press:
        alias: toggle
"""
    config = make_config(text)
    assert config.gppu_mask == 0x01


def test_pull_up_modes_and_mask():
    text = BASE + """
  external:
    pin: GPA1
    type: momentary
    pull_up: external
    debounce_ms: 30
    actions:
      on_press:
        alias: toggle
"""
    config = make_config(text)
    assert config.buttons[1].valid is True
    assert config.gppu_mask == 0x01


def test_yaml_handler_receives_the_parsed_data():
    handler = cfghandler.ConfigHandler('mcp23017-direct')
    handler.config_dict(YAML(typ='rt').load(BASE))
    assert parse_config(handler).bus == 1
