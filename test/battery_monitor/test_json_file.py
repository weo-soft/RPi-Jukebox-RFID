import json
import os
from unittest.mock import Mock

import pytest

import jukebox.plugs as plugin

from components.battery_monitor import BatteryMonitorBase
from components.battery_monitor.BatteryMonitorBase import BatterySourceError

# The adapter module registers itself through the plugin loader; importing it
# directly requires the loader to accept direct imports.
plugin.ALLOW_DIRECT_IMPORTS = True
from components.battery_monitor.batt_mon_json_file import battmon_json_file  # noqa: E402
plugin.ALLOW_DIRECT_IMPORTS = False


class FakeConfig:
    """Configuration double exposing the ``setndefault`` interface."""

    def __init__(self, values=None):
        self.values = dict(values or {})

    def setndefault(self, *keys, value=None):
        return self.values.setdefault('.'.join(keys), value)


class FakeTimer:
    instances = []

    def __init__(self, name, wait_seconds, function):
        self.name = name
        self.wait_seconds = wait_seconds
        self.function = function
        FakeTimer.instances.append(self)

    def start(self):
        pass

    def close(self):
        pass


@pytest.fixture
def publisher(monkeypatch):
    publisher = Mock()
    monkeypatch.setattr(BatteryMonitorBase.publishing, 'get_publisher', lambda: publisher)
    monkeypatch.setattr(BatteryMonitorBase.multitimer, 'GenericEndlessTimerClass', FakeTimer)
    return publisher


def make_adapter(publisher, path, **values):
    config = {'battmon.json_file.path': str(path)}
    config.update(values)
    return battmon_json_file(FakeConfig(config))


def write_status(path, payload):
    path.write_text(json.dumps(payload), encoding='utf-8')


CANONICAL = {
    'soc': 87,
    'state': 'charging',
    'voltage_v': 12.005,
    'current_ma': 450.0,
    'power_w': 5.4,
    'timestamp': '2026-10-29T20:00:00+00:00',
}


def test_canonical_file_is_published(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, CANONICAL)
    adapter = make_adapter(publisher, path)

    adapter.publish_status()

    status = adapter.batt_status
    assert status['available'] is True
    assert status['source'] == 'json_file'
    assert status['soc'] == 87
    assert status['state'] == 'charging'
    assert status['charging'] is True
    assert status['voltage'] == 12005
    assert status['voltage_v'] == 12.005
    assert status['current_ma'] == 450.0
    assert status['power_w'] == 5.4
    assert status['timestamp'] == '2026-10-29T20:00:00+00:00'


def test_field_mapping_remaps_source_keys(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, {'percent': 87, 'battery_voltage_v': 12.0, 'current_ma': 450.0})
    adapter = make_adapter(
        publisher,
        path,
        **{'battmon.json_file.fields': {
            'soc': 'percent',
            'voltage_v': 'battery_voltage_v',
            'power_w': None,
        }},
    )

    adapter.publish_status()

    status = adapter.batt_status
    assert status['soc'] == 87
    assert status['voltage'] == 12000
    assert status['power_w'] == 5.4


def test_state_mapping_normalizes_source_values(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, {'soc': 50, 'state': 'on-battery'})
    adapter = make_adapter(
        publisher,
        path,
        **{'battmon.json_file.states': {'on-battery': 'discharging'}},
    )

    adapter.publish_status()
    assert adapter.batt_status['state'] == 'discharging'
    assert adapter.batt_status['charging'] is False

    write_status(path, {'soc': 50, 'state': 'unknown-to-me'})
    adapter.publish_status()
    assert adapter.batt_status['state'] == 'unknown'


def test_missing_file_is_a_source_error(publisher, tmp_path):
    adapter = make_adapter(publisher, tmp_path / 'missing.json')

    with pytest.raises(BatterySourceError):
        adapter.read()


def test_stale_file_is_a_source_error(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, CANONICAL)
    old = 1_600_000_000
    os.utime(path, (old, old))
    adapter = make_adapter(publisher, path, **{'battmon.json_file.stale_after_sec': 30})

    with pytest.raises(BatterySourceError, match='old'):
        adapter.read()


def test_invalid_json_is_a_source_error(publisher, tmp_path):
    path = tmp_path / 'status.json'
    path.write_text('{"soc": 50,', encoding='utf-8')
    adapter = make_adapter(publisher, path)

    with pytest.raises(BatterySourceError):
        adapter.read()

    path.write_text('[1, 2, 3]', encoding='utf-8')
    with pytest.raises(BatterySourceError):
        adapter.read()


def test_error_object_of_the_source_is_a_source_error(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, {'status': 'error', 'timestamp': '2026-10-29T20:00:00+00:00', 'error': 'i2c'})
    adapter = make_adapter(publisher, path)

    with pytest.raises(BatterySourceError):
        adapter.read()


def test_soc_is_clamped_to_the_valid_range(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, {'soc': 150})
    adapter = make_adapter(publisher, path)

    adapter.publish_status()
    assert adapter.batt_status['soc'] == 100

    write_status(path, {'soc': -5})
    adapter.publish_status()
    assert adapter.batt_status['soc'] == 0


def test_power_is_derived_as_a_positive_value(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, {'soc': 60, 'voltage_v': 12.0, 'current_ma': -450})
    adapter = make_adapter(publisher, path)

    adapter.publish_status()

    assert adapter.batt_status['power_w'] == 5.4


def test_optional_fields_and_disabled_mapping(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, {'soc': 60, 'voltage_v': 12.0, 'remaining_s': 3600, 'state': 'idle', 'power_w': 99.9})
    adapter = make_adapter(
        publisher,
        path,
        **{'battmon.json_file.fields': {'power_w': None}},
    )

    adapter.publish_status()

    status = adapter.batt_status
    assert status['remaining_s'] == 3600
    assert status['state'] == 'idle'
    assert 'power_w' not in status


def test_voltage_only_file_is_rejected(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, {'voltage_v': 12.0})
    adapter = make_adapter(publisher, path)

    with pytest.raises(BatterySourceError):
        adapter.read()


def test_non_iso_timestamp_falls_back_to_the_file_time(publisher, tmp_path):
    path = tmp_path / 'status.json'
    write_status(path, {'soc': 60, 'timestamp': 'yesterday'})
    adapter = make_adapter(publisher, path)

    adapter.publish_status()

    assert adapter.batt_status['timestamp'].endswith('+00:00')
    assert adapter.batt_status['timestamp'] != 'yesterday'


def test_missing_path_is_a_configuration_error(publisher, tmp_path):
    with pytest.raises(ValueError, match='path'):
        battmon_json_file(FakeConfig())


def test_invalid_stale_after_is_a_configuration_error(publisher, tmp_path):
    with pytest.raises(ValueError, match='stale_after_sec'):
        battmon_json_file(FakeConfig({
            'battmon.json_file.path': str(tmp_path / 'status.json'),
            'battmon.json_file.stale_after_sec': 0,
        }))


def test_unknown_field_name_is_a_configuration_error(publisher, tmp_path):
    with pytest.raises(ValueError, match='known field'):
        battmon_json_file(FakeConfig({
            'battmon.json_file.path': str(tmp_path / 'status.json'),
            'battmon.json_file.fields': {'voltage': 'bus_voltage_v'},
        }))
