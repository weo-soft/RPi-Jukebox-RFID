"""Tests for the display settings installer helper."""

import importlib.util
from pathlib import Path

from ruamel.yaml import YAML


MODULE_PATH = (
    Path(__file__).parents[2]
    / 'installation/helpers/display_settings.py'
)
SPEC = importlib.util.spec_from_file_location(
    'display_settings_under_test',
    MODULE_PATH,
)
display_settings = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(display_settings)


def make_devices(root, *names):
    root.mkdir(parents=True)
    for name in names:
        (root / name).mkdir()
    return root


def read_yaml(path):
    yaml = YAML(typ='safe')
    with path.open(encoding='utf-8') as handle:
        return yaml.load(handle)


def test_sets_single_device_and_preserves_comments(tmp_path, monkeypatch):
    root = make_devices(tmp_path / 'backlight', 'panel')
    monkeypatch.setattr(display_settings, 'BACKLIGHT_ROOT', root)
    yaml_path = tmp_path / 'jukebox.yaml'
    yaml_path.write_text(
        '# top comment\n'
        'display:\n'
        '  # keep me\n'
        '  backlight_device: ""\n'
        '  ddc_control: auto\n',
        encoding='utf-8',
    )

    assert display_settings.main([str(yaml_path)]) == 0

    data = read_yaml(yaml_path)
    assert data['display']['backlight_device'] == 'panel'
    assert data['display']['ddc_control'] == 'auto'
    text = yaml_path.read_text(encoding='utf-8')
    assert '# top comment' in text
    assert '# keep me' in text


def test_multiple_devices_leave_the_value_empty(tmp_path, monkeypatch):
    root = make_devices(tmp_path / 'backlight', 'panel', 'other')
    monkeypatch.setattr(display_settings, 'BACKLIGHT_ROOT', root)
    yaml_path = tmp_path / 'jukebox.yaml'
    yaml_path.write_text(
        'display:\n  backlight_device: ""\n',
        encoding='utf-8',
    )

    assert display_settings.main([str(yaml_path)]) == 0

    assert read_yaml(yaml_path)['display']['backlight_device'] == ''


def test_existing_value_is_not_overwritten(tmp_path, monkeypatch):
    root = make_devices(tmp_path / 'backlight', 'panel')
    monkeypatch.setattr(display_settings, 'BACKLIGHT_ROOT', root)
    yaml_path = tmp_path / 'jukebox.yaml'
    yaml_path.write_text(
        'display:\n  backlight_device: rpi_backlight\n',
        encoding='utf-8',
    )

    assert display_settings.main([str(yaml_path)]) == 0

    assert read_yaml(yaml_path)['display']['backlight_device'] == 'rpi_backlight'


def test_missing_display_section_is_created(tmp_path, monkeypatch):
    root = make_devices(tmp_path / 'backlight', 'panel')
    monkeypatch.setattr(display_settings, 'BACKLIGHT_ROOT', root)
    yaml_path = tmp_path / 'jukebox.yaml'
    yaml_path.write_text(
        'webapp:\n  show_covers: true\n',
        encoding='utf-8',
    )

    assert display_settings.main([str(yaml_path)]) == 0

    data = read_yaml(yaml_path)
    assert data['display']['backlight_device'] == 'panel'
    assert 'ddc_control' not in data['display']


def test_no_device_returns_the_advisory_exit_code(tmp_path, monkeypatch):
    root = tmp_path / 'backlight'
    root.mkdir()
    monkeypatch.setattr(display_settings, 'BACKLIGHT_ROOT', root)
    yaml_path = tmp_path / 'jukebox.yaml'
    yaml_path.write_text(
        'display:\n  backlight_device: ""\n',
        encoding='utf-8',
    )

    assert display_settings.main([str(yaml_path)]) == 2

    assert read_yaml(yaml_path)['display']['backlight_device'] == ''


def test_ddc_control_is_never_written(tmp_path, monkeypatch):
    root = make_devices(tmp_path / 'backlight', 'panel')
    monkeypatch.setattr(display_settings, 'BACKLIGHT_ROOT', root)
    yaml_path = tmp_path / 'jukebox.yaml'
    yaml_path.write_text(
        'display:\n  backlight_device: ""\n  ddc_control: off\n',
        encoding='utf-8',
    )

    assert display_settings.main([str(yaml_path)]) == 0

    data = read_yaml(yaml_path)
    assert data['display']['backlight_device'] == 'panel'
    assert data['display']['ddc_control'] == 'off'


def test_invalid_yaml_returns_an_error(tmp_path, monkeypatch):
    root = make_devices(tmp_path / 'backlight', 'panel')
    monkeypatch.setattr(display_settings, 'BACKLIGHT_ROOT', root)
    yaml_path = tmp_path / 'jukebox.yaml'
    yaml_path.write_text('display: [unclosed\n', encoding='utf-8')

    assert display_settings.main([str(yaml_path)]) == 1


def test_missing_file_returns_an_error(tmp_path, monkeypatch):
    root = make_devices(tmp_path / 'backlight', 'panel')
    monkeypatch.setattr(display_settings, 'BACKLIGHT_ROOT', root)

    assert display_settings.main([str(tmp_path / 'missing.yaml')]) == 1
