# MIT License
#
# Copyright (c) 2021 Arne Pagel
#
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all
# copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
# SOFTWARE.
#
# Contributing author(s):
# - Arne Pagel

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import jukebox.plugs as plugs
import jukebox.publishing as publishing
import jukebox.multitimer as multitimer
import jukebox.utils as utils

batt_mon = None

#: States an adapter may report and the base class publishes.
BATTERY_STATES = ('charging', 'discharging', 'idle', 'unknown')

#: State of the status object while no reading is available.
UNAVAILABLE_STATE = 'unavailable'


class BatterySourceError(Exception):
    """Raised by an adapter when a reading cannot be obtained."""


@dataclass
class BatteryReading:
    """Normalized measurement of a battery adapter.

    Every field is optional. A field that is ``None`` is treated as unknown and
    is left out of the published status object.
    """

    soc: Optional[int] = None
    state: Optional[str] = None
    voltage_v: Optional[float] = None
    current_ma: Optional[float] = None
    power_w: Optional[float] = None
    remaining_s: Optional[int] = None
    timestamp: Optional[str] = None


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec='seconds')


class pt1_frac():
    '''fixed point first order filter, fractional format: 2^16,2^16'''
    def __init__(self, coeff, init=0):
        self.coeff = int(65536 * coeff)
        self.store = int(init) << 16

    def iter(self, input):
        self.store = self.store + ((input - (self.store >> 16)) * self.coeff)
        return (self.store >> 16)


def interpolate(cc, input):
    key_list = list(cc.keys())
    next_key = key_list[-1]
    prev_key = key_list[0]

    if (input <= prev_key):
        y = cc[prev_key]
    elif (input >= next_key):
        y = cc[next_key]
    else:
        for key in key_list:
            if (key < input):
                prev_key = key
            else:
                next_key = key
                break

        prev_value = cc[prev_key]
        next_value = cc[next_key]

        # linear interpolation
        temp = ((input - prev_key) * (next_value - prev_value) / (next_key - prev_key))
        y = temp + prev_value

    return y


class BattmonBase():
    '''Battery Monitor base class

    An adapter inherits from this class, implements :meth:`init_batt_mon_hw` and
    overrides either :meth:`read` or :meth:`get_batt_voltage`. The base class
    polls the adapter, normalizes the reading, evaluates the configured
    thresholds and publishes the result on the ``batt_status`` topic.
    '''

    #: Short name of the measurement source, published as ``source``.
    source_name = 'unknown'
    #: Whether the base class may derive ``soc`` from the voltage curve.
    soc_from_voltage = True

    def __init__(self, cfg, logger):
        self._logger = logger
        self.f1 = None
        self.fs = None
        self._warning_active = False
        self._shutdown_issued = False
        self._last_error = None

        self.soc_cc = {3000: 0,
                       3200: 5,
                       3500: 20,
                       3900: 90,
                       4000: 95,
                       4200: 100}

        self.warning_voltage_mv = cfg.setndefault('battmon', 'warning_voltage_mv', value=3300)
        self.all_clear_voltage_mv = cfg.setndefault('battmon', 'all_clear_voltage_mv', value=3400)
        self.shutdown_voltage_mv = cfg.setndefault('battmon', 'shutdown_voltage_mv', value=3000)
        self.warning_soc = cfg.setndefault('battmon', 'warning_soc', value=None)
        self.all_clear_soc = cfg.setndefault('battmon', 'all_clear_soc', value=None)
        self.shutdown_soc = cfg.setndefault('battmon', 'shutdown_soc', value=None)
        self.warning_action = cfg.setndefault('battmon', 'warning_action', value=None)
        self.all_clear_action = cfg.setndefault('battmon', 'all_clear_action', value=None)

        self.interval = cfg.setndefault('battmon', 'poll_interval_sec', value=5)
        if not isinstance(self.interval, (int, float)) or self.interval < 1:
            raise ValueError("battmon.poll_interval_sec must be at least 1")

        num = cfg.setndefault('battmon', 'scale_to_phy_num', value=35)
        denom = cfg.setndefault('battmon', 'scale_to_phy_denom', value=15)

        self.batt_status = self._initial_status()
        self.init_batt_mon_hw(num, denom)

        self.status_thread = multitimer.GenericEndlessTimerClass('batt_mon.timer_status', self.interval, self.publish_status)
        self.status_thread.start()

    def init_batt_mon_hw(self, num, denom):
        self._logger.error("init_batt_mon_hw shall be overwritten")

    def get_batt_voltage(self):
        self._logger.error("get_batt_voltage shall be overwritten")
        return None

    def read(self) -> BatteryReading:
        """Return the current reading.

        The default implementation reads the battery voltage through
        :meth:`get_batt_voltage`. Adapters with more measurement values override
        this method.
        """
        voltage_mv = self.get_batt_voltage()
        if voltage_mv is None:
            raise BatterySourceError("adapter provides no voltage")
        return BatteryReading(voltage_v=float(voltage_mv) / 1000.0)

    @plugs.tag
    def get_batt_status(self):
        return (self.batt_status)

    def publish_status(self):
        try:
            reading = self.read()
        except Exception as error:
            self._publish_error(error)
            return

        self._clear_error()
        derived = self._derive_values(reading)
        self._evaluate_thresholds(derived)

        self.batt_status = self._build_status(reading, derived)
        self._logger.info(f"SOC: {derived['soc']}%, Batt Voltage: {derived['voltage_mv']}mV, state: {derived['state']}")

        publishing.get_publisher().send('batt_status', self.batt_status)

    def _initial_status(self) -> Dict[str, Any]:
        return {
            'available': False,
            'state': UNAVAILABLE_STATE,
            'charging': False,
            'source': self.source_name,
            'timestamp': _utc_now(),
        }

    def _derive_values(self, reading: BatteryReading) -> Dict[str, Any]:
        voltage_mv = None
        voltage_slow = None
        if reading.voltage_v is not None:
            raw_mv = int(round(float(reading.voltage_v) * 1000))
            if self.f1 is None:
                self.f1 = pt1_frac(0.5, raw_mv)
                self.fs = pt1_frac(0.01, raw_mv)
            voltage_mv = self.f1.iter(raw_mv)
            voltage_slow = self.fs.iter(raw_mv)

        soc = reading.soc
        if soc is None and self.soc_from_voltage and voltage_mv is not None:
            soc = int(interpolate(self.soc_cc, voltage_mv))
        if soc is not None:
            soc = int(max(0, min(100, round(float(soc)))))

        state = reading.state
        if state is not None and state not in BATTERY_STATES:
            state = 'unknown'
        if state is None:
            if voltage_mv is not None:
                state = 'charging' if (voltage_mv - voltage_slow) >= 0 else 'discharging'
            else:
                state = 'unknown'

        return {
            'soc': soc,
            'state': state,
            'charging': state == 'charging',
            'voltage_mv': voltage_mv,
        }

    def _build_status(self, reading: BatteryReading, derived: Dict[str, Any]) -> Dict[str, Any]:
        timestamp = reading.timestamp
        if not isinstance(timestamp, str) or not timestamp:
            timestamp = _utc_now()
        status = {
            'available': True,
            'state': derived['state'],
            'charging': derived['charging'],
            'source': self.source_name,
            'timestamp': timestamp,
        }
        if derived['soc'] is not None:
            status['soc'] = derived['soc']
        if derived['voltage_mv'] is not None:
            status['voltage'] = derived['voltage_mv']
            status['voltage_v'] = round(derived['voltage_mv'] / 1000.0, 3)
        if reading.current_ma is not None:
            status['current_ma'] = round(float(reading.current_ma), 1)
        if reading.power_w is not None:
            status['power_w'] = round(abs(float(reading.power_w)), 3)
        if reading.remaining_s is not None:
            status['remaining_s'] = int(reading.remaining_s)
        return status

    def _publish_error(self, error: Exception):
        message = f"{type(error).__name__}: {error}"
        if message != self._last_error:
            self._logger.warning(f"Battery source unavailable: {message}")
            self._last_error = message

        self.batt_status = {
            'available': False,
            'state': UNAVAILABLE_STATE,
            'charging': False,
            'source': self.source_name,
            'timestamp': _utc_now(),
        }
        publishing.get_publisher().send('batt_status', self.batt_status)

    def _clear_error(self):
        if self._last_error is not None:
            self._logger.info("Battery source is available again")
            self._last_error = None

    def _evaluate_thresholds(self, derived: Dict[str, Any]):
        voltage_mv = derived['voltage_mv']
        soc = derived['soc']
        self._evaluate_warning(voltage_mv, soc)
        self._evaluate_shutdown(voltage_mv, soc)

    def _evaluate_warning(self, voltage_mv, soc):
        triggered = False
        checked = False
        if self.warning_voltage_mv is not None and voltage_mv is not None:
            checked = True
            triggered = triggered or voltage_mv < self.warning_voltage_mv
        if self.warning_soc is not None and soc is not None:
            checked = True
            triggered = triggered or soc <= self.warning_soc

        cleared = True
        cleared_checked = False
        if self.all_clear_voltage_mv is not None and voltage_mv is not None:
            cleared_checked = True
            cleared = cleared and voltage_mv >= self.all_clear_voltage_mv
        if self.all_clear_soc is not None and soc is not None:
            cleared_checked = True
            cleared = cleared and soc >= self.all_clear_soc

        if not self._warning_active and checked and triggered:
            self._warning_active = True
            self._logger.warning(f"Battery warning: {soc}%, {voltage_mv}mV")
            if self.warning_action is not None:
                utils.decode_and_call_rpc_command(self.warning_action, self._logger)
        elif self._warning_active and cleared_checked and cleared:
            self._warning_active = False
            self._logger.info(f"Battery warning cleared: {soc}%, {voltage_mv}mV")
            if self.all_clear_action is not None:
                utils.decode_and_call_rpc_command(self.all_clear_action, self._logger)

    def _evaluate_shutdown(self, voltage_mv, soc):
        if self._shutdown_issued:
            return

        triggered = False
        checked = False
        if self.shutdown_voltage_mv is not None and voltage_mv is not None:
            checked = True
            triggered = voltage_mv < self.shutdown_voltage_mv
        if self.shutdown_soc is not None and soc is not None:
            checked = True
            triggered = triggered or soc <= self.shutdown_soc

        if checked and triggered:
            self._shutdown_issued = True
            self._logger.warning(f"Shutdown due to low Battery: {soc}%, Batt Voltage: {voltage_mv}mV")
            plugs.call_ignore_errors('host', 'shutdown')
