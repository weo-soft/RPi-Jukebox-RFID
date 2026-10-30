"""Test doubles for the MCP23017 plugin tests."""

from typing import Any, Dict, Optional

import jukebox.cfghandler as cfghandler
from components.gpio.mcp23017.config import McpConfig, parse_config
from ruamel.yaml import YAML


class FakeClock:
    """Monotonic clock that only moves when the test advances it."""

    def __init__(self, start: float = 0.0):
        self._now = start

    def __call__(self) -> float:
        return self._now

    def advance(self, seconds: float) -> None:
        self._now += seconds


class FakeChipProbe:
    """Stand-in for lgpio.gpio_get_chip_info."""

    def __init__(self, lines: int = 16, status: int = 0,
                 name: str = 'gpiochip2', label: str = 'unknown'):
        self.lines = lines
        self.status = status
        self.name = name
        self.label = label
        self.calls = []

    def __call__(self, number: int):
        self.calls.append(number)
        return self.status, self.lines, self.name, self.label


class FakeBackend:
    """In-memory backend with recorded GPPU writes."""

    def __init__(self, values: Optional[Dict[int, int]] = None, gppu: int = 0):
        self.values = dict(values or {})
        self.gppu = gppu
        self.writes = []
        self.opened = False
        self.closed = False
        self.read_error: Optional[Exception] = None
        self.write_error: Optional[Exception] = None

    def open(self) -> None:
        self.opened = True

    def close(self) -> None:
        self.closed = True

    def read_pin(self, line: int) -> int:
        if self.read_error is not None:
            raise self.read_error
        return self.values.get(line, 1)

    def write_gppu(self, mask: int) -> None:
        if self.write_error is not None:
            raise self.write_error
        self.writes.append(mask)
        self.gppu = mask

    def read_gppu(self) -> int:
        return self.gppu


class Recorder:
    """Collects the calls of the bound actions."""

    def __init__(self):
        self.calls = []

    def action(self, label: str):
        def _record() -> str:
            self.calls.append(label)
            return label
        return _record


class FakeBinder:
    """Bind resolved actions to recorder callables without the plugin loader."""

    def __init__(self, recorder: Recorder):
        self._recorder = recorder

    def bind(self, action: Any):
        return self._recorder.action(f'{action.package}.{action.plugin}.{action.method}')


def make_config(text: str) -> McpConfig:
    """Parse a YAML snippet through the real config handler."""
    handler = cfghandler.ConfigHandler('mcp23017-test')
    handler.config_dict(YAML(typ='rt').load(text))
    return parse_config(handler)
