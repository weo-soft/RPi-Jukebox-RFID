"""Chip detection and I2C backend tests for the MCP23017 plugin."""

import subprocess

import pytest

from components.gpio.mcp23017 import device
from components.gpio.mcp23017.device import (
    BackendError,
    LgpioBackend,
    detect_chip,
    find_i2c_tool,
)
from mcp23017_fakes import FakeChipProbe


def make_sysfs(tmp_path, chips=(2,), name='mcp23017'):
    root = tmp_path / 'sys'
    client = root / 'bus' / 'i2c' / 'devices' / '1-0020'
    client.mkdir(parents=True)
    if name is not None:
        (client / 'name').write_text(name + '\n', encoding='utf-8')
    for chip in chips:
        (client / f'gpiochip{chip}').mkdir()
    return root, client


def test_detect_chip_from_i2c_child(tmp_path):
    root, _ = make_sysfs(tmp_path)
    probe = FakeChipProbe()
    assert detect_chip(1, 0x20, None, probe, sys_root=str(root)) == 2
    assert probe.calls == [2]


def test_detect_chip_reports_missing_device(tmp_path):
    root, _ = make_sysfs(tmp_path, chips=())
    with pytest.raises(BackendError) as error:
        detect_chip(1, 0x20, None, FakeChipProbe(), sys_root=str(root))
    assert '1-0020' in str(error.value)
    assert 'i2cdetect' in str(error.value)


def test_detect_chip_rejects_ambiguous_chip(tmp_path):
    root, _ = make_sysfs(tmp_path, chips=(2, 3))
    with pytest.raises(BackendError) as error:
        detect_chip(1, 0x20, None, FakeChipProbe(), sys_root=str(root))
    assert 'More than one' in str(error.value)


def test_detect_chip_rejects_a_different_i2c_device(tmp_path):
    root, _ = make_sysfs(tmp_path, name='pcf8574')
    with pytest.raises(BackendError) as error:
        detect_chip(1, 0x20, None, FakeChipProbe(), sys_root=str(root))
    assert 'pcf8574' in str(error.value)


def test_detect_chip_rejects_a_foreign_driver(tmp_path):
    root, client = make_sysfs(tmp_path)
    driver = tmp_path / 'drivers' / 'other'
    driver.mkdir(parents=True)
    (client / 'driver').symlink_to(driver)
    with pytest.raises(BackendError) as error:
        detect_chip(1, 0x20, None, FakeChipProbe(), sys_root=str(root))
    assert 'other' in str(error.value)


def test_detect_chip_rejects_wrong_line_count(tmp_path):
    root, _ = make_sysfs(tmp_path)
    with pytest.raises(BackendError) as error:
        detect_chip(1, 0x20, None, FakeChipProbe(lines=8), sys_root=str(root))
    assert '16' in str(error.value)


def test_fixed_chip_uses_the_probe(tmp_path):
    probe = FakeChipProbe(lines=16)
    assert detect_chip(1, 0x20, 5, probe, sys_root=str(tmp_path)) == 5
    assert probe.calls == [5]


def test_fixed_chip_with_failed_probe(tmp_path):
    probe = FakeChipProbe(status=-1)
    with pytest.raises(BackendError):
        detect_chip(1, 0x20, 5, probe, sys_root=str(tmp_path))


def make_tool(tmp_path, name, body):
    path = tmp_path / name
    path.write_text('#!/bin/sh\n' + body + '\n', encoding='utf-8')
    path.chmod(0o755)
    return str(path)


def make_backend(tmp_path, i2cget_body):
    log = tmp_path / 'writes.log'
    get = make_tool(tmp_path, 'i2cget', i2cget_body)
    set_tool = make_tool(tmp_path, 'i2cset', f'echo "$@" >> "{log}"')
    backend = LgpioBackend(chip=2, bus=1, address=0x20, lines=[],
                           i2cset=set_tool, i2cget=get, sleep=lambda _: None)
    return backend, log


def test_write_gppu_verifies_readback(tmp_path):
    backend, log = make_backend(tmp_path, 'case "$5" in\n'
                                           '  0x0c) echo 0x1f;;\n'
                                           '  0x0d) echo 0x00;;\n'
                                           '  *) echo 0x00;;\n'
                                           'esac')
    backend.write_gppu(0x1f)
    assert backend.read_gppu() == 0x1f
    lines = log.read_text(encoding='utf-8').splitlines()
    assert any('0x0c 0x1f' in line for line in lines)
    assert any('0x0d 0x00' in line for line in lines)


def test_write_gppu_fails_after_three_attempts(tmp_path):
    backend, log = make_backend(tmp_path, 'echo 0x00')
    with pytest.raises(BackendError) as error:
        backend.write_gppu(0x1f)
    assert 'after 3 attempts' in str(error.value)
    assert len(log.read_text(encoding='utf-8').splitlines()) == 6


def test_check_bank_rejects_bank_one(tmp_path):
    backend, _ = make_backend(tmp_path, 'case "$5" in\n'
                                         '  0x05) echo 0x80;;\n'
                                         '  *) echo 0x00;;\n'
                                         'esac')
    with pytest.raises(BackendError) as error:
        backend.check_bank()
    assert 'BANK' in str(error.value)


def test_failing_tool_raises_backend_error(tmp_path):
    backend, _ = make_backend(tmp_path, 'exit 3')
    with pytest.raises(BackendError) as error:
        backend.read_gppu()
    assert 'exit code 3' in str(error.value)


def test_unexpected_tool_output(tmp_path):
    backend, _ = make_backend(tmp_path, 'echo nonsense')
    with pytest.raises(BackendError) as error:
        backend.read_gppu()
    assert 'Unexpected' in str(error.value)


def test_tool_timeout(tmp_path, monkeypatch):
    backend, _ = make_backend(tmp_path, 'echo 0x00')

    def timeout(*args, **kwargs):
        raise subprocess.TimeoutExpired('i2cget', 2)

    monkeypatch.setattr(device.subprocess, 'run', timeout)
    with pytest.raises(BackendError) as error:
        backend.read_gppu()
    assert 'timed out' in str(error.value)


def test_missing_i2c_tools(tmp_path):
    with pytest.raises(BackendError) as error:
        LgpioBackend(chip=2, bus=1, address=0x20, lines=[],
                     i2cset=str(tmp_path / 'missing'), i2cget=str(tmp_path / 'missing'))
    assert 'i2c-tools' in str(error.value)


def test_find_i2c_tool_returns_none_for_unknown_tool():
    assert find_i2c_tool('mcp23017-tool-that-does-not-exist') is None
