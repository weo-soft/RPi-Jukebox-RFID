from unittest.mock import Mock

import pytest

from components.battery_monitor import BatteryMonitorBase
from components.battery_monitor.BatteryMonitorBase import BatteryReading, BatterySourceError


class FakeConfig:
    """Configuration double exposing the ``setndefault`` interface."""

    def __init__(self, values=None):
        self.values = dict(values or {})

    def setndefault(self, *keys, value=None):
        return self.values.setdefault('.'.join(keys), value)


class FakeTimer:
    """Timer double that records its parameters without starting a thread."""

    instances = []

    def __init__(self, name, wait_seconds, function):
        self.name = name
        self.wait_seconds = wait_seconds
        self.function = function
        self.started = False
        self.closed = False
        FakeTimer.instances.append(self)

    def start(self):
        self.started = True

    def close(self):
        self.closed = True


class FakeAdapter(BatteryMonitorBase.BattmonBase):
    source_name = 'fake'

    def __init__(self, cfg, logger):
        self.reading = None
        self.error = None
        self.read_calls = 0
        super().__init__(cfg, logger)

    def init_batt_mon_hw(self, num, denom):
        pass

    def read(self):
        self.read_calls += 1
        if self.error is not None:
            raise self.error
        return self.reading


class VoltageAdapter(BatteryMonitorBase.BattmonBase):
    """Adapter double that uses the default ``read`` implementation."""

    source_name = 'legacy'

    def __init__(self, cfg, logger):
        self.voltage_mv = 3900
        super().__init__(cfg, logger)

    def init_batt_mon_hw(self, num, denom):
        pass

    def get_batt_voltage(self):
        return self.voltage_mv


def make_adapter(monkeypatch, **values):
    publisher = Mock()
    monkeypatch.setattr(BatteryMonitorBase.publishing, 'get_publisher', lambda: publisher)
    monkeypatch.setattr(BatteryMonitorBase.multitimer, 'GenericEndlessTimerClass', FakeTimer)
    FakeTimer.instances = []
    logger = Mock()
    adapter = FakeAdapter(FakeConfig(values), logger)
    return adapter, publisher, logger


def poll(adapter, reading, times=1):
    adapter.reading = reading
    for _ in range(times):
        adapter.publish_status()
    return adapter.batt_status


def test_construction_does_not_read_and_starts_the_timer(monkeypatch):
    adapter, publisher, _logger = make_adapter(monkeypatch, **{'battmon.poll_interval_sec': 9})

    assert adapter.read_calls == 0
    assert publisher.send.call_count == 0
    timer = FakeTimer.instances[-1]
    assert timer.name == 'batt_mon.timer_status'
    assert timer.wait_seconds == 9
    assert timer.started is True
    assert adapter.batt_status['available'] is False
    assert adapter.batt_status['state'] == 'unavailable'
    assert adapter.batt_status['source'] == 'fake'
    assert adapter.batt_status['timestamp']


def test_voltage_only_reading_derives_soc_from_the_curve(monkeypatch):
    adapter, publisher, _logger = make_adapter(monkeypatch)

    status = poll(adapter, BatteryReading(voltage_v=4.0))

    assert status['available'] is True
    assert status['voltage'] == 4000
    assert status['voltage_v'] == 4.0
    assert status['soc'] == 95
    assert status['state'] == 'charging'
    assert status['charging'] is True
    assert publisher.send.call_args.args[0] == 'batt_status'


def test_voltage_history_derives_the_state(monkeypatch):
    adapter, _publisher, _logger = make_adapter(monkeypatch)
    poll(adapter, BatteryReading(voltage_v=4.0))

    assert poll(adapter, BatteryReading(voltage_v=3.9))['state'] == 'discharging'
    assert poll(adapter, BatteryReading(voltage_v=4.1))['state'] == 'charging'


def test_adapter_soc_wins_over_the_voltage_curve(monkeypatch):
    adapter, _publisher, _logger = make_adapter(monkeypatch)

    status = poll(adapter, BatteryReading(soc=55, voltage_v=3.9))

    assert status['soc'] == 55


def test_adapter_state_controls_charging(monkeypatch):
    adapter, _publisher, _logger = make_adapter(monkeypatch)

    assert poll(adapter, BatteryReading(soc=50, state='idle', voltage_v=3.8))['charging'] is False
    assert poll(adapter, BatteryReading(soc=50, state='charging', voltage_v=3.8))['charging'] is True
    assert poll(adapter, BatteryReading(soc=50, state='nonsense', voltage_v=3.8))['state'] == 'unknown'


def test_soc_only_reading_publishes_without_voltage(monkeypatch):
    adapter, _publisher, _logger = make_adapter(
        monkeypatch,
        **{'battmon.warning_soc': 20, 'battmon.warning_action': {'alias': 'warn'}},
    )
    action = Mock()
    monkeypatch.setattr(BatteryMonitorBase.utils, 'decode_and_call_rpc_command', action)

    status = poll(adapter, BatteryReading(soc=10))

    assert 'voltage' not in status
    assert 'voltage_v' not in status
    assert status['soc'] == 10
    assert status['state'] == 'unknown'
    action.assert_called_once_with({'alias': 'warn'}, adapter._logger)


def test_read_error_publishes_unavailable_and_logs_once(monkeypatch):
    adapter, _publisher, logger = make_adapter(
        monkeypatch,
        **{'battmon.warning_voltage_mv': 3300, 'battmon.warning_action': {'alias': 'warn'}},
    )
    action = Mock()
    shutdown = Mock()
    monkeypatch.setattr(BatteryMonitorBase.utils, 'decode_and_call_rpc_command', action)
    monkeypatch.setattr(BatteryMonitorBase.plugs, 'call_ignore_errors', shutdown)
    adapter.error = BatterySourceError('sensor silent')

    status = poll(adapter, None, times=3)

    assert status['available'] is False
    assert status['state'] == 'unavailable'
    assert status['charging'] is False
    assert status['source'] == 'fake'
    assert logger.warning.call_count == 1
    action.assert_not_called()
    shutdown.assert_not_called()


def test_recovery_after_error_restores_values(monkeypatch):
    adapter, _publisher, logger = make_adapter(monkeypatch)
    adapter.error = BatterySourceError('sensor silent')
    poll(adapter, None)

    adapter.error = None
    status = poll(adapter, BatteryReading(soc=80, voltage_v=3.9))

    assert status['available'] is True
    assert status['soc'] == 80
    assert status['voltage'] == 3900
    assert adapter.get_batt_status() == status
    assert any('available again' in str(call.args) for call in logger.info.call_args_list)


def test_threshold_actions_trigger_once_per_transition(monkeypatch):
    warning_action = {'alias': 'warn'}
    all_clear_action = {'alias': 'clear'}
    adapter, _publisher, _logger = make_adapter(
        monkeypatch,
        **{'battmon.warning_action': warning_action, 'battmon.all_clear_action': all_clear_action},
    )
    action = Mock()
    shutdown = Mock()
    monkeypatch.setattr(BatteryMonitorBase.utils, 'decode_and_call_rpc_command', action)
    monkeypatch.setattr(BatteryMonitorBase.plugs, 'call_ignore_errors', shutdown)

    poll(adapter, BatteryReading(voltage_v=3.2), times=2)
    assert action.call_count == 1
    assert action.call_args.args[0] == warning_action

    poll(adapter, BatteryReading(voltage_v=3.8), times=3)
    assert action.call_count == 2
    assert action.call_args.args[0] == all_clear_action

    poll(adapter, BatteryReading(voltage_v=2.6), times=5)
    assert shutdown.call_count == 1
    shutdown.assert_called_once_with('host', 'shutdown')
    assert action.call_args.args[0] == warning_action


def test_error_suppresses_every_threshold_action(monkeypatch):
    adapter, _publisher, _logger = make_adapter(
        monkeypatch,
        **{
            'battmon.warning_voltage_mv': 4000,
            'battmon.shutdown_voltage_mv': 3500,
            'battmon.warning_action': {'alias': 'warn'},
        },
    )
    action = Mock()
    shutdown = Mock()
    monkeypatch.setattr(BatteryMonitorBase.utils, 'decode_and_call_rpc_command', action)
    monkeypatch.setattr(BatteryMonitorBase.plugs, 'call_ignore_errors', shutdown)
    adapter.error = BatterySourceError('sensor silent')

    poll(adapter, None, times=2)

    action.assert_not_called()
    shutdown.assert_not_called()


def test_partial_values_evaluate_only_available_conditions(monkeypatch):
    adapter, _publisher, _logger = make_adapter(
        monkeypatch,
        **{
            'battmon.warning_soc': 20,
            'battmon.all_clear_soc': 90,
            'battmon.warning_action': {'alias': 'warn'},
            'battmon.all_clear_action': {'alias': 'clear'},
        },
    )
    action = Mock()
    monkeypatch.setattr(BatteryMonitorBase.utils, 'decode_and_call_rpc_command', action)

    poll(adapter, BatteryReading(soc=15))
    assert action.call_count == 1

    poll(adapter, BatteryReading(soc=50))
    assert action.call_count == 1

    poll(adapter, BatteryReading(soc=95))
    assert action.call_count == 2
    assert action.call_args.args[0] == {'alias': 'clear'}


def test_voltage_adapter_keeps_the_legacy_read_path(monkeypatch):
    publisher = Mock()
    monkeypatch.setattr(BatteryMonitorBase.publishing, 'get_publisher', lambda: publisher)
    monkeypatch.setattr(BatteryMonitorBase.multitimer, 'GenericEndlessTimerClass', FakeTimer)
    adapter = VoltageAdapter(FakeConfig(), Mock())

    adapter.publish_status()

    status = adapter.batt_status
    assert status['available'] is True
    assert status['source'] == 'legacy'
    assert status['voltage'] == 3900
    assert status['voltage_v'] == 3.9
    assert status['soc'] == 90
    assert status['charging'] is True


def test_poll_interval_defaults_to_five(monkeypatch):
    adapter, _publisher, _logger = make_adapter(monkeypatch)

    assert adapter.interval == 5


def test_poll_interval_below_one_is_rejected(monkeypatch):
    with pytest.raises(ValueError, match='poll_interval_sec'):
        FakeAdapter(FakeConfig({'battmon.poll_interval_sec': 0}), Mock())
