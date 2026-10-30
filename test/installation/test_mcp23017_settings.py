"""Tests for the installer helper that updates the MCP23017 settings."""

import os
import sys

from ruamel.yaml import YAML

REPOSITORY_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.join(REPOSITORY_ROOT, 'installation', 'helpers'))

import mcp23017_settings  # noqa: E402


def load(path):
    with open(path, encoding='utf-8') as stream:
        return YAML(typ='rt').load(stream)


def test_set_device_settings_keeps_comments(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text('# keep this comment\nbus: 1\naddress: 0x20\nbuttons: {}\n',
                    encoding='utf-8')
    mcp23017_settings.set_device_settings(str(path), '2', '0x21')
    text = path.read_text(encoding='utf-8')
    assert '# keep this comment' in text
    data = load(str(path))
    assert data['bus'] == 2
    assert int(data['address']) == 0x21


def test_enable_module_keeps_gpioz_untouched(tmp_path):
    path = tmp_path / 'jukebox.yaml'
    path.write_text('gpioz:\n  enable: false\n'
                    'mcp23017:\n  enable: false\n  config_file: config.yaml\n',
                    encoding='utf-8')
    mcp23017_settings.enable_module(str(path))
    data = load(str(path))
    assert data['mcp23017']['enable'] is True
    assert data['gpioz']['enable'] is False
    assert data['mcp23017']['config_file'] == 'config.yaml'


def test_enable_module_creates_a_missing_section(tmp_path):
    path = tmp_path / 'jukebox.yaml'
    path.write_text('gpioz:\n  enable: true\n', encoding='utf-8')
    mcp23017_settings.enable_module(str(path))
    data = load(str(path))
    assert data['mcp23017']['enable'] is True
    assert data['gpioz']['enable'] is True


def test_main_device(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text('bus: 1\naddress: 0x20\n', encoding='utf-8')
    assert mcp23017_settings.main(['tool', 'device', str(path), '1', '0x22']) == 0
    assert int(load(str(path))['address']) == 0x22


def test_main_module(tmp_path):
    path = tmp_path / 'jukebox.yaml'
    path.write_text('gpioz:\n  enable: false\n', encoding='utf-8')
    assert mcp23017_settings.main(['tool', 'module', str(path)]) == 0
    assert load(str(path))['mcp23017']['enable'] is True


def test_main_rejects_bad_usage():
    assert mcp23017_settings.main(['tool']) == 2
    assert mcp23017_settings.main(['tool', 'unknown', 'file.yaml']) == 2
    assert mcp23017_settings.main(['tool', 'device', 'file.yaml', '1']) == 2
    assert mcp23017_settings.main(['tool', 'module', 'a.yaml', 'b']) == 2
