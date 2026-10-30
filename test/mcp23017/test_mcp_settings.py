"""Catalog matching and YAML persistence tests for the button settings."""

import pytest
import jukebox.cfghandler as cfghandler

from components.gpio.mcp23017.catalog import (
    action_entry,
    action_id_for,
    catalog_entries,
)
from components.gpio.mcp23017.config import parse_config
from components.gpio.mcp23017.settings import assign_button, clear_button
from mcp23017_fakes import make_config

CONFIG = """# keep this comment
bus: 1
address: 0x20
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


def load(path):
    handler = cfghandler.ConfigHandler('mcp-settings')
    cfghandler.load_yaml(handler, str(path))
    return parse_config(handler)


def test_catalog_contains_the_expected_actions():
    ids = [entry['id'] for entry in catalog_entries()]
    assert ids == ['play_pause', 'next', 'previous', 'volume_up', 'volume_down',
                   'shutdown', 'reboot', 'say_ip']
    assert action_entry('volume_up')['type'] == 'hold_repeat'
    assert action_entry('does_not_exist') is None


def test_action_ids_are_matched_from_the_configuration(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text(CONFIG, encoding='utf-8')
    config = load(path)
    assert [action_id_for(button) for button in config.buttons] == [
        'play_pause', 'previous', 'volume_up']


def test_advanced_buttons_are_not_matched(tmp_path):
    text = CONFIG.replace('type: momentary', 'type: short_long_press', 1)
    text = text.replace('on_press:', 'on_short_press:', 1)
    text = text.replace('debounce_ms: 30', 'debounce_ms: 30\n    hold_ms: 500', 1)
    config = make_config(text)
    assert action_id_for(config.buttons[0]) is None


def test_assign_adds_a_button_and_keeps_comments(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text(CONFIG, encoding='utf-8')
    assign_button(str(path), 6, action_entry('volume_up'), 1, 0x20)
    text = path.read_text(encoding='utf-8')
    assert '# keep this comment' in text
    config = load(path)
    by_pin = {button.pin: button for button in config.buttons}
    assert by_pin[6].name == 'volume_up_2'
    assert by_pin[6].type == 'hold_repeat'
    assert by_pin[6].hold_ms == 500
    assert by_pin[6].actions['on_press'].alias == 'change_volume'
    assert by_pin[6].actions['on_press'].args == [2]
    assert by_pin[0].name == 'play_pause'
    assert by_pin[3].name == 'volume_up'


def test_assign_reuses_the_name_of_an_assigned_pin(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text(CONFIG, encoding='utf-8')
    assign_button(str(path), 0, action_entry('next'), 1, 0x20)
    config = load(path)
    button = next(entry for entry in config.buttons if entry.pin == 0)
    assert button.name == 'play_pause'
    assert button.type == 'momentary'
    assert button.actions['on_press'].alias == 'next_song'


def test_clear_removes_only_the_selected_pin(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text(CONFIG, encoding='utf-8')
    clear_button(str(path), 3, 1, 0x20)
    config = load(path)
    assert [button.pin for button in config.buttons] == [0, 2]
    assert '# keep this comment' in path.read_text(encoding='utf-8')


def test_assign_creates_a_missing_file(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    assign_button(str(path), 0, action_entry('play_pause'), 1, 0x21)
    config = load(path)
    assert config.bus == 1
    assert config.address == 0x21
    assert len(config.buttons) == 1
    assert config.buttons[0].pin == 0


def test_clear_of_an_unassigned_pin_is_a_no_op(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text(CONFIG, encoding='utf-8')
    before = path.read_text(encoding='utf-8')
    clear_button(str(path), 15, 1, 0x20)
    assert path.read_text(encoding='utf-8') == before


def test_assign_rejects_an_invalid_pin(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text(CONFIG, encoding='utf-8')
    with pytest.raises(Exception):
        assign_button(str(path), 16, action_entry('next'), 1, 0x20)
