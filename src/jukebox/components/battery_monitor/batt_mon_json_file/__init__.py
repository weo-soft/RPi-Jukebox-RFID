# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder

import json
import logging
import os
import time
from datetime import datetime, timezone
from typing import Any, Dict, Optional

import jukebox.cfghandler
import jukebox.plugs as plugs
from components.battery_monitor import BatteryMonitorBase
from components.battery_monitor.BatteryMonitorBase import BATTERY_STATES, BatteryReading, BatterySourceError

logger = logging.getLogger('jb.battmon.json_file')

batt_mon = None

#: Canonical fields a mapping entry may address.
CANONICAL_FIELDS = ('soc', 'state', 'voltage_v', 'current_ma', 'power_w', 'remaining_s', 'timestamp')


def _parse_timestamp(value: Any) -> Optional[str]:
    """Return a normalized ISO 8601 timestamp or ``None``."""
    if not isinstance(value, str):
        return None
    text = value.strip()
    if text.endswith('Z'):
        text = text[:-1] + '+00:00'
    try:
        parsed = datetime.fromisoformat(text)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.isoformat(timespec='seconds')


class battmon_json_file(BatteryMonitorBase.BattmonBase):
    '''Battery Monitor reading a JSON status file

    See [Battery Monitor documentation](../../builders/components/power/batterymonitor.md)
    '''

    source_name = 'json_file'
    soc_from_voltage = False

    def __init__(self, cfg):
        self._path = None
        self._stale_after = None
        self._fields: Dict[str, Optional[str]] = {}
        self._states: Dict[str, str] = {}
        super().__init__(cfg, logger)

    def init_batt_mon_hw(self, num, denom):
        path = self._cfg.setndefault('battmon', 'json_file', 'path', value=None)
        if not isinstance(path, str) or not path:
            raise ValueError("battmon.json_file.path must be configured")
        self._path = path

        stale_after = self._cfg.setndefault('battmon', 'json_file', 'stale_after_sec', value=30)
        if not isinstance(stale_after, (int, float)) or stale_after <= 0:
            raise ValueError("battmon.json_file.stale_after_sec must be greater than zero")
        self._stale_after = float(stale_after)

        self._fields = self._read_fields()
        self._states = self._read_mapping('states')

    def _read_fields(self) -> Dict[str, Any]:
        mapping = self._read_mapping('fields')
        for key in mapping:
            if key not in CANONICAL_FIELDS:
                raise ValueError(f"battmon.json_file.fields.{key} is not a known field")
        return mapping

    def _read_mapping(self, name: str) -> Dict[str, Any]:
        mapping = self._cfg.setndefault('battmon', 'json_file', name, value={})
        if not isinstance(mapping, dict):
            raise ValueError(f"battmon.json_file.{name} must be a mapping")
        for key, entry in mapping.items():
            if entry is not None and not isinstance(entry, str):
                raise ValueError(f"battmon.json_file.{name}.{key} must be a string or null")
        return mapping

    def read(self) -> BatteryReading:
        stat = self._stat_status_file()
        payload = self._load_payload()

        soc = self._read_soc(payload)
        state = self._map_state(self._mapped(payload, 'state'))
        voltage_v = self._read_number(payload, 'voltage_v')
        current_ma = self._read_number(payload, 'current_ma')
        power_w = self._read_number(payload, 'power_w')
        remaining_s = self._read_integer(payload, 'remaining_s')

        if power_w is None and voltage_v is not None and current_ma is not None:
            power_w = abs(voltage_v * current_ma / 1000.0)

        return BatteryReading(
            soc=soc,
            state=state,
            voltage_v=voltage_v,
            current_ma=current_ma,
            power_w=power_w,
            remaining_s=remaining_s,
            timestamp=self._read_timestamp(payload, stat),
        )

    def _stat_status_file(self):
        try:
            stat = os.stat(self._path)
        except FileNotFoundError:
            raise BatterySourceError(f"status file {self._path} is missing")
        except OSError as error:
            raise BatterySourceError(f"cannot access {self._path}: {error}")

        age = time.time() - stat.st_mtime
        if age > self._stale_after:
            raise BatterySourceError(f"status file is {int(age)}s old")
        return stat

    def _load_payload(self) -> Dict[str, Any]:
        try:
            with open(self._path, encoding='utf-8') as handle:
                payload = json.load(handle)
        except OSError as error:
            raise BatterySourceError(f"cannot read {self._path}: {error}")
        except ValueError as error:
            raise BatterySourceError(f"invalid JSON in {self._path}: {error}")

        if not isinstance(payload, dict):
            raise BatterySourceError(f"{self._path} does not contain a JSON object")
        return payload

    def _mapped(self, payload: Dict[str, Any], canonical: str) -> Any:
        source_key = self._fields.get(canonical, canonical)
        if source_key is None:
            return None
        return payload.get(source_key)

    def _read_number(self, payload: Dict[str, Any], canonical: str) -> Optional[float]:
        value = self._mapped(payload, canonical)
        if value is None:
            return None
        try:
            return float(value)
        except (TypeError, ValueError):
            raise BatterySourceError(f"field {canonical} is not a number")

    def _read_integer(self, payload: Dict[str, Any], canonical: str) -> Optional[int]:
        value = self._mapped(payload, canonical)
        if value is None:
            return None
        try:
            return int(float(value))
        except (TypeError, ValueError):
            raise BatterySourceError(f"field {canonical} is not a number")

    def _read_soc(self, payload: Dict[str, Any]) -> int:
        value = self._mapped(payload, 'soc')
        if value is None:
            raise BatterySourceError("status file provides no state of charge")
        soc = self._read_number(payload, 'soc')
        return int(max(0, min(100, round(soc))))

    def _map_state(self, value: Any) -> Optional[str]:
        if value is None:
            return None
        mapped = self._states.get(value, value)
        if not isinstance(mapped, str) or mapped not in BATTERY_STATES:
            return 'unknown'
        return mapped

    def _read_timestamp(self, payload: Dict[str, Any], stat) -> str:
        timestamp = _parse_timestamp(self._mapped(payload, 'timestamp'))
        if timestamp is not None:
            return timestamp
        return datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(timespec='seconds')


@plugs.finalize
def finalize():
    global batt_mon
    cfg = jukebox.cfghandler.get_handler('jukebox')
    batt_mon = battmon_json_file(cfg)
    plugs.register(batt_mon, name='batt_mon')


@plugs.atexit
def atexit(**ignored_kwargs):
    global batt_mon
    batt_mon.status_thread.close()
