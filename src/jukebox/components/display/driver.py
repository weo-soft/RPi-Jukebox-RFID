"""Display backends: brightness sources, power paths and write serialization.

:class:`DisplayDriver` resolves the available capabilities once at startup.
Brightness comes from sysfs, DDC/CI or an X11 gamma fallback; power comes
from ``vcgencmd``, DDC/CI or X11 DPMS.  Hardware sources are preferred, X11
is the software fallback.  All writes are serialized through a single worker
thread with last-value-wins semantics.
"""

import glob
import logging
import os
import re
import shutil
import subprocess
import threading

logger = logging.getLogger('jb.display.driver')

DEFAULT_MAX_BRIGHTNESS = 255
PROBE_TIMEOUT = 5
WRITE_TIMEOUT = 5
X11_PROBE_TIMEOUT = 2
SUDO_TIMEOUT = 2

ERROR_NO_BACKLIGHT = 'no_backlight_device'
ERROR_BACKLIGHT_STALE = 'backlight_device_stale'
ERROR_NO_DDC = 'no_ddc_access'
ERROR_NO_X = 'no_x_access'
ERROR_X_OUTPUT = 'x_output_missing'
ERROR_NO_CONTROL = 'no_display_control'

_ERROR_CODES = {
    ERROR_NO_BACKLIGHT,
    ERROR_BACKLIGHT_STALE,
    ERROR_NO_DDC,
    ERROR_NO_X,
    ERROR_X_OUTPUT,
    ERROR_NO_CONTROL,
}


def percent_to_raw(percent, max_brightness):
    """Map a brightness percentage to a device raw value."""
    bounded = max(0, min(100, int(percent)))
    return int(round(bounded / 100 * max_brightness))


def raw_to_percent(raw, max_brightness):
    """Map a device raw value to a brightness percentage."""
    if max_brightness <= 0:
        return 0
    bounded = max(0, min(max_brightness, int(raw)))
    return int(round(bounded / max_brightness * 100))


def _run_command(args, timeout, input_text=None, env=None):
    """Run a command without a shell and return its result or ``None``."""
    try:
        return subprocess.run(
            args,
            input=input_text,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
            env=env,
        )
    except (OSError, subprocess.SubprocessError) as error:
        logger.warning(
            'Command %s failed: %s: %s',
            args[0] if args else '',
            error.__class__.__name__,
            error,
        )
        return None


def _kms_display_active():
    """Return whether the vc4 KMS driver owns the display."""
    return os.path.isdir('/sys/module/vc4')


def _read_process_arguments(process_path):
    try:
        if os.stat(process_path).st_uid != os.getuid():
            return None
        with open(f'{process_path}/cmdline', 'rb') as handle:
            parts = handle.read().split(b'\0')
    except OSError:
        return None
    return [part.decode('utf-8', 'replace') for part in parts if part]


def _xorg_authority(arguments):
    if not arguments or os.path.basename(arguments[0]) not in ('Xorg', 'X'):
        return None
    for index, argument in enumerate(arguments[:-1]):
        if argument == '-auth':
            return arguments[index + 1]
    return None


def _latest_serverauth():
    try:
        return sorted(
            glob.glob('/tmp/serverauth.*'),
            key=os.path.getmtime,
            reverse=True,
        )
    except OSError:
        return []


def _find_x_authority():
    """Return the X authority file of the running Xorg server."""
    candidates = []
    try:
        entries = os.listdir('/proc')
    except OSError:
        entries = []
    for entry in entries:
        if not entry.isdigit():
            continue
        arguments = _read_process_arguments(f'/proc/{entry}')
        if arguments is None:
            continue
        candidate = _xorg_authority(arguments)
        if candidate:
            candidates.append(candidate)
    candidates.extend(_latest_serverauth())
    for candidate in candidates:
        if os.path.isfile(candidate):
            return candidate
    return None


class SysfsBacklight:
    """Brightness control through ``/sys/class/backlight``."""

    def __init__(self, device_override='', sysfs_root='/sys/class/backlight'):
        self._root = sysfs_root
        self._path = ''
        self.device = ''
        self.max_brightness = DEFAULT_MAX_BRIGHTNESS
        self.available = False
        self.stale_override = False
        self._resolve(device_override)

    def _resolve(self, device_override):
        candidates = [
            path for path in sorted(glob.glob(os.path.join(self._root, '*')))
            if os.path.isdir(path)
        ]
        if device_override:
            preferred = os.path.join(self._root, device_override)
            if os.path.isdir(preferred):
                self._path = preferred
            else:
                self.stale_override = True
        if not self._path and candidates:
            self._path = candidates[0]
        if not self._path:
            return
        self.device = os.path.basename(self._path)
        self.max_brightness = self._read_max_brightness()
        self.available = True

    def _read_max_brightness(self):
        path = os.path.join(self._path, 'max_brightness')
        try:
            with open(path, encoding='ascii') as handle:
                value = int(handle.read().strip())
        except (OSError, ValueError):
            return DEFAULT_MAX_BRIGHTNESS
        return value if value > 0 else DEFAULT_MAX_BRIGHTNESS

    def set_percent(self, percent):
        """Write a brightness percentage to the device."""
        if not self.available:
            raise RuntimeError(ERROR_NO_BACKLIGHT)
        raw = percent_to_raw(percent, self.max_brightness)
        target = os.path.join(self._path, 'brightness')
        try:
            with open(target, 'w', encoding='ascii') as handle:
                handle.write(f'{raw}\n')
        except PermissionError:
            self._write_with_sudo(target, raw)

    def _write_with_sudo(self, target, raw):
        result = _run_command(
            ['sudo', '-n', 'tee', target],
            SUDO_TIMEOUT,
            input_text=f'{raw}\n',
        )
        if result is None or result.returncode != 0:
            raise RuntimeError(ERROR_NO_BACKLIGHT)

    def get_percent(self):
        """Read the current brightness percentage."""
        if not self.available:
            return None
        for name in ('actual_brightness', 'brightness'):
            path = os.path.join(self._path, name)
            try:
                with open(path, encoding='ascii') as handle:
                    return raw_to_percent(
                        int(handle.read().strip()),
                        self.max_brightness,
                    )
            except (OSError, ValueError):
                continue
        return None


class DdcBrightness:
    """Brightness and power control through ``ddcutil``."""

    def __init__(self, display=1, control='auto'):
        self.display = int(display)
        self.control = control
        self.available = False
        self.power_available = False
        self.max_value = 100

    def _getvcp(self, code):
        result = _run_command(
            ['ddcutil', '-d', str(self.display), 'getvcp', code],
            PROBE_TIMEOUT,
        )
        if result is None or result.returncode != 0:
            return None
        return result.stdout

    @staticmethod
    def _parse(output):
        if not output:
            return None
        current = re.search(r'current value\s*=\s*(\d+)', output, re.IGNORECASE)
        if current is None:
            return None
        maximum = re.search(r'max value\s*=\s*(\d+)', output, re.IGNORECASE)
        max_value = int(maximum.group(1)) if maximum else 100
        if max_value <= 0:
            max_value = 100
        return int(current.group(1)), max_value

    def probe(self):
        """Check whether DDC/CI brightness control answers."""
        parsed = self._parse(self._getvcp('10'))
        if parsed is None:
            return False
        self.max_value = parsed[1]
        self.available = True
        return True

    def probe_power(self):
        """Check whether DDC/CI power control answers."""
        if self._getvcp('d6') is None:
            return False
        self.power_available = True
        return True

    def get_percent(self):
        """Read brightness through DDC/CI."""
        parsed = self._parse(self._getvcp('10'))
        if parsed is None:
            return None
        return raw_to_percent(parsed[0], parsed[1])

    def set_percent(self, percent):
        """Write brightness through DDC/CI."""
        if not self.available:
            raise RuntimeError(ERROR_NO_DDC)
        raw = percent_to_raw(percent, self.max_value)
        result = _run_command(
            ['ddcutil', '-d', str(self.display), 'setvcp', '10', str(raw)],
            WRITE_TIMEOUT,
        )
        if result is None or result.returncode != 0:
            raise RuntimeError(ERROR_NO_DDC)

    def set_power(self, on):
        """Switch the monitor on or off through DDC/CI."""
        if not self.power_available:
            raise RuntimeError(ERROR_NO_DDC)
        value = '1' if on else '4'
        result = _run_command(
            ['ddcutil', '-d', str(self.display), 'setvcp', 'd6', value],
            WRITE_TIMEOUT,
        )
        if result is None or result.returncode != 0:
            raise RuntimeError(ERROR_NO_DDC)


class X11Control:
    """Brightness (gamma) and DPMS power control through X11."""

    def __init__(self, output='', control='auto', environ=None):
        self.requested_output = output
        self.control = control
        self._environ = dict(environ or os.environ)
        self.display = self._environ.get('DISPLAY') or ':0'
        self.authority = self._environ.get('XAUTHORITY')
        self.output = ''
        self.available = False
        self.output_missing = False

    def _resolve_environment(self):
        if not self.authority or not os.path.isfile(self.authority):
            self.authority = _find_x_authority()

    def _run_x(self, args, timeout):
        environment = os.environ.copy()
        environment['DISPLAY'] = self.display
        if self.authority:
            environment['XAUTHORITY'] = self.authority
        return _run_command(args, timeout, env=environment)

    def probe(self):
        """Check whether the X server and a connected output are usable."""
        if self.control == 'off':
            return False
        if shutil.which('xset') is None or shutil.which('xrandr') is None:
            return False
        self._resolve_environment()
        if self._run_x(['xset', 'q'], X11_PROBE_TIMEOUT) is None:
            return False
        self.output = self.requested_output or self._detect_output() or ''
        if not self.output:
            self.output_missing = True
            return False
        self.available = True
        return True

    def _detect_output(self):
        result = self._run_x(['xrandr', '--query'], X11_PROBE_TIMEOUT)
        if result is None or result.returncode != 0:
            return None
        fallback = None
        for line in result.stdout.splitlines():
            if ' connected ' not in line:
                continue
            name = line.split()[0]
            if ' connected primary ' in line:
                return name
            if fallback is None:
                fallback = name
        return fallback

    def set_percent(self, percent):
        """Apply a brightness percentage as an X gamma multiplier."""
        if not self.available:
            raise RuntimeError(ERROR_NO_X)
        value = max(0.01, min(1.0, percent / 100))
        result = self._run_x(
            ['xrandr', '--output', self.output, '--brightness', f'{value:.2f}'],
            WRITE_TIMEOUT,
        )
        if result is None or result.returncode != 0:
            raise RuntimeError(ERROR_NO_X)

    def get_percent(self):
        """Read the gamma brightness of the configured output."""
        if not self.available:
            return None
        result = self._run_x(['xrandr', '--verbose'], WRITE_TIMEOUT)
        if result is None or result.returncode != 0:
            return None
        active = False
        for line in result.stdout.splitlines():
            if line.startswith(f'{self.output} '):
                active = True
                continue
            if active:
                match = re.search(r'Brightness:\s*([0-9.]+)', line)
                if match:
                    value = float(match.group(1))
                    return max(0, min(100, int(round(value * 100))))
        return None

    def set_power(self, on):
        """Switch the panel through DPMS."""
        if not self.available:
            raise RuntimeError(ERROR_NO_X)
        action = 'on' if on else 'off'
        result = self._run_x(['xset', 'dpms', 'force', action], WRITE_TIMEOUT)
        if result is None or result.returncode != 0:
            raise RuntimeError(ERROR_NO_X)
        if on:
            self._disable_dpms()

    def _disable_dpms(self):
        result = self._run_x(['xset', '-dpms'], WRITE_TIMEOUT)
        if result is None or result.returncode != 0:
            logger.warning('Could not restore the kiosk DPMS state')

    def ensure_on(self):
        """Return the panel to power-on without raising."""
        if not self.available:
            return
        result = self._run_x(['xset', 'dpms', 'force', 'on'], WRITE_TIMEOUT)
        if result is None or result.returncode != 0:
            logger.warning('Could not switch the X11 panel on')
        self._disable_dpms()


class VcgencmdPower:
    """Power switching through the Raspberry Pi firmware command."""

    def __init__(self):
        self.command = shutil.which('vcgencmd')
        self.available = bool(self.command) and not _kms_display_active()

    def set_power(self, on):
        """Switch HDMI power through ``vcgencmd``."""
        if not self.available:
            raise RuntimeError(ERROR_NO_CONTROL)
        result = _run_command(
            [self.command, 'display_power', '1' if on else '0'],
            WRITE_TIMEOUT,
        )
        if result is None or result.returncode != 0:
            raise RuntimeError(ERROR_NO_CONTROL)


class DisplayDriver:
    """Resolve display capabilities and serialize all write operations."""

    def __init__(self, config=None, status_callback=None, sysfs_root=None):
        self._config = dict(config or {})
        self._status_callback = status_callback
        self._sysfs_root = sysfs_root or '/sys/class/backlight'
        self._lock = threading.RLock()
        self._condition = threading.Condition(self._lock)
        self._pending = {}
        self._order = []
        self._stopping = False
        self._busy = False
        self._write_error = None
        self._brightness_percent = int(self._config.get('brightness', 100))
        self.brightness_source = None
        self.power_path = None
        self.max_brightness = None
        self.backlight_device = ''
        self.backlight = None
        self.ddc = None
        self.x11 = None
        self.vcgencmd = None
        self._resolution_errors = []
        self._resolve()
        self._worker = threading.Thread(
            target=self._run_worker,
            name='display-writer',
            daemon=True,
        )
        self._worker.start()

    def _resolve(self):
        config = self._config
        self.backlight = SysfsBacklight(
            config.get('backlight_device', ''),
            sysfs_root=self._sysfs_root,
        )
        self.ddc = DdcBrightness(
            config.get('ddc_display', 1),
            config.get('ddc_control', 'auto'),
        )
        self.x11 = X11Control(
            config.get('x11_output', ''),
            config.get('x11_control', 'auto'),
        )
        self.vcgencmd = VcgencmdPower()
        self._resolution_errors = []
        self.brightness_source = None
        self.power_path = None

        self._resolve_brightness()
        self._resolve_power()
        self.max_brightness = (
            self.backlight.max_brightness
            if self.brightness_source == 'sysfs' else None
        )
        self.backlight_device = (
            self.backlight.device if self.brightness_source == 'sysfs' else ''
        )
        if self.brightness_source is None and self.power_path is None:
            self._resolution_errors.append(ERROR_NO_CONTROL)

    def _resolve_brightness(self):
        if self.backlight.available:
            self.brightness_source = 'sysfs'
            if self.backlight.stale_override:
                self._resolution_errors.append(ERROR_BACKLIGHT_STALE)
            if self.ddc.control == 'on':
                if self.ddc.probe():
                    self.brightness_source = 'ddc'
                else:
                    self._resolution_errors.append(ERROR_NO_DDC)
            return
        self._resolution_errors.append(ERROR_NO_BACKLIGHT)
        if self.ddc.control != 'off':
            if self.ddc.probe():
                self.brightness_source = 'ddc'
                return
            self._resolution_errors.append(ERROR_NO_DDC)
        self._resolve_x11_brightness()

    def _resolve_x11_brightness(self):
        if self.x11.control == 'off':
            return
        if self.x11.probe():
            self.brightness_source = 'x11'
            return
        if self.x11.output_missing:
            self._resolution_errors.append(ERROR_X_OUTPUT)
        else:
            self._resolution_errors.append(ERROR_NO_X)

    def _resolve_power(self):
        if self.vcgencmd.available:
            self.power_path = 'vcgencmd'
            return
        if (
                not self.backlight.available
                and self.ddc.control != 'off'
                and self.ddc.probe_power()):
            self.power_path = 'ddc'
            return
        if self.brightness_source == 'x11' and self.x11.available:
            self.power_path = 'x11'

    def resolve_standby_mechanic(self):
        """Return the active standby mechanic or ``None``."""
        requested = self._config.get('standby_mechanic', 'auto')
        if requested == 'auto':
            if self.brightness_source in ('sysfs', 'ddc'):
                return 'backlight'
            if self.power_path is not None:
                return 'power_off'
            return None
        if requested == 'backlight':
            return 'backlight' if self.brightness_source else None
        if requested == 'power_off':
            if self.power_path is not None:
                return 'power_off'
            if self.brightness_source:
                return 'backlight'
        return None

    def get_percent(self):
        """Return the current brightness percentage of the active source."""
        if self.brightness_source == 'sysfs':
            return self.backlight.get_percent()
        if self.brightness_source == 'ddc':
            return self.ddc.get_percent()
        if self.brightness_source == 'x11':
            return self.x11.get_percent()
        return None

    def set_percent(self, percent):
        """Queue a brightness change (last value wins)."""
        self._submit('percent', int(percent))

    def set_power(self, on):
        """Queue a power change (last value wins)."""
        self._submit('power', bool(on))

    def apply_initial(self, percent=None):
        """Apply the initial brightness and return an X11 panel to power-on."""
        if percent is not None:
            self._brightness_percent = int(percent)
        if self.x11.available:
            self.x11.ensure_on()
        if self.brightness_source:
            try:
                self._write_percent(self._brightness_percent)
            except Exception as error:
                self._write_error = self._error_code(error)

    def shutdown(self):
        """Stop the writer and return an X11 panel to power-on."""
        if self.x11.available:
            self.x11.ensure_on()
        with self._condition:
            self._stopping = True
            self._condition.notify_all()
        if self._worker.is_alive():
            self._worker.join(timeout=WRITE_TIMEOUT)

    def _submit(self, kind, value):
        with self._condition:
            if self._stopping:
                return
            if kind not in self._pending:
                self._order.append(kind)
            self._pending[kind] = value
            self._busy = True
            self._condition.notify_all()

    def _run_worker(self):
        while True:
            with self._condition:
                while not self._order and not self._stopping:
                    self._condition.wait()
                if self._stopping and not self._order:
                    return
                kind = self._order.pop(0)
                value = self._pending.pop(kind)
                self._busy = True
            self._publish()
            try:
                if kind == 'percent':
                    self._write_percent(value)
                else:
                    self._write_power(value)
            except Exception as error:
                code = self._error_code(error)
                logger.warning('Display write failed: %s', code)
                with self._lock:
                    self._write_error = code
            else:
                with self._lock:
                    self._write_error = None
            with self._condition:
                self._busy = bool(self._order)
            self._publish()

    def _write_percent(self, percent, remember=True):
        if remember:
            self._brightness_percent = int(percent)
        if self.brightness_source == 'sysfs':
            self.backlight.set_percent(percent)
        elif self.brightness_source == 'ddc':
            self.ddc.set_percent(percent)
        elif self.brightness_source == 'x11':
            self.x11.set_percent(percent)
        else:
            raise RuntimeError(ERROR_NO_CONTROL)

    def _write_power(self, on):
        mechanic = self.resolve_standby_mechanic()
        if on:
            if mechanic == 'power_off' and self.power_path is not None:
                self._set_power_path(True)
            if self.brightness_source:
                self._write_percent(self._brightness_percent)
            elif mechanic is None:
                raise RuntimeError(ERROR_NO_CONTROL)
            return
        if mechanic == 'power_off':
            self._set_power_path(False)
        elif mechanic == 'backlight':
            self._write_percent(0, remember=False)
        else:
            raise RuntimeError(ERROR_NO_CONTROL)

    def _set_power_path(self, on):
        if self.power_path == 'vcgencmd':
            self.vcgencmd.set_power(on)
        elif self.power_path == 'ddc':
            self.ddc.set_power(on)
        elif self.power_path == 'x11':
            self.x11.set_power(on)
        else:
            raise RuntimeError(ERROR_NO_CONTROL)

    def _publish(self):
        if self._status_callback is None:
            return
        try:
            self._status_callback()
        except Exception as error:
            logger.warning('Display status callback failed: %s', error)

    @staticmethod
    def _error_code(error):
        message = str(error)
        return message if message in _ERROR_CODES else ERROR_NO_CONTROL

    def get_status(self):
        """Return the driver part of ``display.status``."""
        with self._lock:
            errors = list(self._resolution_errors)
            if self._write_error and self._write_error not in errors:
                errors.append(self._write_error)
            return {
                'brightness_source': self.brightness_source,
                'max_brightness': self.max_brightness,
                'backlight_device': self.backlight_device,
                'dim_available': self.brightness_source is not None,
                'busy': self._busy or bool(self._order),
                'errors': errors,
            }
