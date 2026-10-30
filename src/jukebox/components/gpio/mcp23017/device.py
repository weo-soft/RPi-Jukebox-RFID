# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder
"""
GPIO chip detection and hardware access for the MCP23017 buttons.

Reads go through the kernel driver provided ``gpiochip`` with raw ``lgpio``
calls. The internal pull-ups are not reachable through the kernel pin
configuration path on this chip, so they are written directly to the
``GPPU`` registers with ``i2cset -f`` and verified with ``i2cget -f``.
"""

import logging
import os
import re
import shutil
import subprocess
import time
from typing import Callable, List, Optional, Sequence, Tuple

logger = logging.getLogger('jb.mcp23017')

CHIP_LINES = 16
REGISTER_IOCON = 0x05
REGISTER_GPPUA = 0x0C
REGISTER_GPPUB = 0x0D
BANK_BIT = 0x80
I2C_TIMEOUT_SECONDS = 2
GPPU_ATTEMPTS = 3
GPPU_RETRY_DELAY_SECONDS = 0.3
_GPIOCHIP_PATTERN = re.compile(r'^gpiochip(\d+)$')
_DRIVER_NAMES = ('mcp230xx', 'mcp23s08', 'gpio-mcp23s08')


class BackendError(RuntimeError):
    """Raised when the GPIO chip or the I2C registers cannot be accessed."""


# Signature of lgpio.gpio_get_chip_info: (status, lines, name, label)
ChipProbe = Callable[[int], Tuple[int, int, str, str]]


def detect_chip(bus: int, address: int, chip: Optional[int],
                probe: ChipProbe, sys_root: str = '/sys') -> int:
    """Return the gpiochip number of the MCP23017 at ``address`` on ``bus``."""
    if chip is not None:
        _check_chip(probe, chip)
        return chip
    client = os.path.join(sys_root, 'bus', 'i2c', 'devices', f'{bus}-{address:04x}')
    candidates = _child_chips(client)
    if not candidates:
        candidates = _matching_gpiochips(sys_root, client)
    if not candidates:
        raise BackendError(
            f"MCP23017 at 0x{address:02x} on I2C bus {bus} not found: no gpiochip "
            f"below '{client}'. Check the overlay and run 'i2cdetect -y {bus}'."
        )
    if len(candidates) > 1:
        numbers = ', '.join(f'gpiochip{number}' for number in candidates)
        raise BackendError(
            f"More than one gpiochip found below '{client}': {numbers}. "
            "Set 'chip' in the configuration."
        )
    _check_client(client)
    number = candidates[0]
    _check_chip(probe, number)
    return number


class LgpioChipProbe:
    """Open a chip with lgpio and ask for its line count and labels."""

    def __call__(self, number: int) -> Tuple[int, int, str, str]:
        import lgpio
        try:
            handle = lgpio.gpiochip_open(number)
        except Exception as error:
            logger.debug('Opening gpiochip%s failed: %s', number, error)
            return -1, 0, '', ''
        try:
            return tuple(lgpio.gpio_get_chip_info(handle))  # type: ignore[return-value]
        except Exception as error:
            logger.debug('Reading chip info of gpiochip%s failed: %s', number, error)
            return -1, 0, '', ''
        finally:
            lgpio.gpiochip_close(handle)


class LgpioBackend:
    """Read the expander lines through the kernel chip and write GPPU over I2C."""

    def __init__(self, chip: int, bus: int, address: int, lines: Sequence[int],
                 i2cset: Optional[str] = None, i2cget: Optional[str] = None,
                 sleep: Callable[[float], None] = time.sleep):
        self._chip = chip
        self._bus = bus
        self._address = address
        self._lines = list(lines)
        self._i2cset = i2cset or find_i2c_tool('i2cset')
        self._i2cget = i2cget or find_i2c_tool('i2cget')
        if not _is_executable(self._i2cset) or not _is_executable(self._i2cget):
            raise BackendError("i2cset/i2cget not found; install the 'i2c-tools' package")
        self._sleep = sleep
        self._lgpio = None
        self._handle = None

    def open(self) -> None:
        """Open the gpiochip and claim the configured lines as inputs."""
        import lgpio
        self._lgpio = lgpio
        try:
            self._handle = lgpio.gpiochip_open(self._chip)
        except Exception as error:
            raise BackendError(f'Cannot open gpiochip{self._chip}: {error}') from error
        if self._handle < 0:
            raise BackendError(f'Cannot open gpiochip{self._chip}: error {self._handle}')
        claimed: List[int] = []
        for line in self._lines:
            result = lgpio.gpio_claim_input(self._handle, line, 0)
            if result < 0:
                for claimed_line in claimed:
                    lgpio.gpio_free(self._handle, claimed_line)
                lgpio.gpiochip_close(self._handle)
                self._handle = None
                raise BackendError(f'Cannot claim line {line} of gpiochip{self._chip}: '
                                   f'error {result}')
            claimed.append(line)

    def close(self) -> None:
        """Free the claimed lines and close the gpiochip."""
        if self._handle is None:
            return
        for line in self._lines:
            self._lgpio.gpio_free(self._handle, line)
        self._lgpio.gpiochip_close(self._handle)
        self._handle = None

    def read_pin(self, line: int) -> int:
        """Return the raw level of one line."""
        if self._handle is None:
            raise BackendError('gpiochip is not open')
        value = self._lgpio.gpio_read(self._handle, line)
        if value < 0:
            raise BackendError(f'Reading line {line} failed: error {value}')
        return value

    def read_iocon(self) -> int:
        return self.read_register(REGISTER_IOCON)

    def check_bank(self) -> None:
        """Require IOCON.BANK = 0, which the register addresses assume."""
        iocon = self.read_iocon()
        if iocon & BANK_BIT:
            raise BackendError('MCP23017 IOCON.BANK is 1; register addressing requires BANK=0')

    def read_gppu(self) -> int:
        return self.read_register(REGISTER_GPPUA) | (self.read_register(REGISTER_GPPUB) << 8)

    def write_gppu(self, mask: int) -> None:
        """Write both pull-up registers and verify the readback."""
        errors = []
        for attempt in range(GPPU_ATTEMPTS):
            try:
                self.write_register(REGISTER_GPPUA, mask & 0xff)
                self.write_register(REGISTER_GPPUB, (mask >> 8) & 0xff)
                readback = self.read_gppu()
                if readback == mask:
                    return
                errors.append(f'readback 0x{readback:04x} != 0x{mask:04x}')
            except BackendError as error:
                errors.append(str(error))
            if attempt + 1 < GPPU_ATTEMPTS:
                self._sleep(GPPU_RETRY_DELAY_SECONDS)
        raise BackendError(f'Writing GPPU failed after {GPPU_ATTEMPTS} attempts: '
                           f"{'; '.join(errors)}")

    def read_register(self, register: int) -> int:
        output = self._run_i2c_tool(self._i2cget, register)
        try:
            return int(output, 0)
        except ValueError:
            raise BackendError(f'Unexpected i2cget output: {output!r}')

    def write_register(self, register: int, value: int) -> None:
        self._run_i2c_tool(self._i2cset, register, value)

    def _run_i2c_tool(self, tool: str, register: int, value: Optional[int] = None) -> str:
        command = [tool, '-f', '-y', str(self._bus), f'0x{self._address:02x}',
                   f'0x{register:02x}']
        if value is not None:
            command.append(f'0x{value:02x}')
        try:
            result = subprocess.run(command, timeout=I2C_TIMEOUT_SECONDS, check=False,
                                    capture_output=True, text=True)
        except subprocess.TimeoutExpired:
            raise BackendError(f"'{tool}' timed out after {I2C_TIMEOUT_SECONDS} s")
        if result.returncode != 0:
            message = result.stderr.strip() or result.stdout.strip()
            raise BackendError(f"'{tool}' failed with exit code {result.returncode}: {message}")
        return result.stdout.strip()


def _is_executable(path: Optional[str]) -> bool:
    return bool(path) and os.path.isfile(path) and os.access(path, os.X_OK)


def find_i2c_tool(name: str) -> Optional[str]:
    """Locate an i2c-tools binary, including the sbin directories."""
    found = shutil.which(name)
    if found:
        return found
    for directory in ('/usr/sbin', '/sbin', '/usr/bin', '/bin'):
        path = os.path.join(directory, name)
        if os.path.isfile(path) and os.access(path, os.X_OK):
            return path
    return None


def _child_chips(client: str) -> List[int]:
    try:
        entries = os.listdir(client)
    except OSError:
        return []
    numbers = []
    for entry in entries:
        match = _GPIOCHIP_PATTERN.match(entry)
        if match:
            numbers.append(int(match.group(1)))
    return sorted(numbers)


def _matching_gpiochips(sys_root: str, client: str) -> List[int]:
    base = os.path.join(sys_root, 'bus', 'gpio', 'devices')
    try:
        entries = os.listdir(base)
    except OSError:
        return []
    client_path = os.path.realpath(client)
    numbers = []
    for entry in entries:
        match = _GPIOCHIP_PATTERN.match(entry)
        if not match:
            continue
        if os.path.dirname(os.path.realpath(os.path.join(base, entry))) == client_path:
            numbers.append(int(match.group(1)))
    return sorted(numbers)


def _check_client(client: str) -> None:
    name_file = os.path.join(client, 'name')
    if os.path.isfile(name_file):
        with open(name_file, encoding='utf-8') as stream:
            name = stream.read().strip()
        if name != 'mcp23017':
            raise BackendError(f"I2C device '{client}' is '{name}', not 'mcp23017'")
    driver_link = os.path.join(client, 'driver')
    if os.path.islink(driver_link):
        driver = os.path.basename(os.path.realpath(driver_link))
        if driver not in _DRIVER_NAMES:
            raise BackendError(f"I2C device '{client}' is bound to driver '{driver}', "
                               f"expected one of {', '.join(_DRIVER_NAMES)}")


def _check_chip(probe: ChipProbe, number: int) -> None:
    status, lines, name, label = probe(number)
    logger.debug('gpiochip%s: status=%s lines=%s name=%s label=%s',
                 number, status, lines, name, label)
    if status != 0:
        raise BackendError(f'Cannot open gpiochip{number}: status {status}')
    if lines != CHIP_LINES:
        raise BackendError(f'gpiochip{number} has {lines} lines, expected {CHIP_LINES}')
