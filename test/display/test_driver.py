"""Tests for the display driver: sources, power paths and write serialization."""

import importlib.util
import os
import threading
import time
from pathlib import Path

import pytest


MODULE_PATH = (
    Path(__file__).parents[2]
    / 'src/jukebox/components/display/driver.py'
)
SPEC = importlib.util.spec_from_file_location(
    'display_driver_under_test',
    MODULE_PATH,
)
driver = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(driver)


class Result:
    """Minimal stand-in for ``subprocess.CompletedProcess``."""

    def __init__(self, stdout='', returncode=0):
        self.stdout = stdout
        self.stderr = ''
        self.returncode = returncode


class FakeX11:
    """Fake X server command runner."""

    def __init__(self, output='HDMI-1', query='connected', q=True):
        self.output = output
        self.query = query
        self.q = q
        self.calls = []
        self.lock = threading.Lock()

    def __call__(self, args, timeout, input_text=None, env=None):
        with self.lock:
            self.calls.append(list(args))
        if args[0] == 'xset' and args[1:] == ['q']:
            return Result() if self.q else None
        if args[0] == 'xrandr' and args[1:] == ['--query']:
            return Result(
                f'{self.output} {self.query} primary 1024x600+0+0 '
                '(normal left inverted right x axis y axis) 154mm x 86mm\n'
            )
        if args[0] == 'xrandr' and '--verbose' in args:
            return Result(
                f'{self.output} connected primary 1024x600+0+0\n'
                '\tBrightness: 0.40\n'
            )
        return Result()

    def calls_with(self, prefix):
        with self.lock:
            return [call for call in self.calls if call[:len(prefix)] == prefix]


def make_runner(ddc_brightness=None, ddc_power=False, x11=None):
    """Build a ``_run_command`` replacement for DDC, vcgencmd and X11."""

    def run(args, timeout, input_text=None, env=None):
        if args[0] == 'ddcutil' and args[3] == 'getvcp':
            if args[4] == '10' and ddc_brightness is not None:
                return Result(ddc_brightness)
            if args[4] == 'd6' and ddc_power:
                return Result('current value = 1, max value = 4')
            return Result('Display not found', returncode=1)
        if args[0] == 'vcgencmd':
            return Result('display_power=1')
        if x11 is not None:
            return x11(args, timeout, input_text, env)
        return None

    return run


def make_which(*names):
    def which(name):
        return f'/usr/bin/{name}' if name in names else None

    return which


def make_backlight(root, name='panel', max_brightness=255, brightness=255):
    path = root / name
    path.mkdir()
    (path / 'max_brightness').write_text(str(max_brightness), encoding='ascii')
    (path / 'brightness').write_text(str(brightness), encoding='ascii')
    (path / 'actual_brightness').write_text(str(brightness), encoding='ascii')
    return path


def wait_idle(instance, timeout=2):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if not instance.get_status()['busy']:
            return
        time.sleep(0.005)
    raise AssertionError('display driver did not become idle')


@pytest.fixture
def make_driver(monkeypatch, tmp_path):
    instances = []

    def factory(
            config,
            run,
            which=(),
            kms=False,
            authority=None,
            status_callback=None):
        monkeypatch.setattr(driver, '_run_command', run)
        monkeypatch.setattr(driver.shutil, 'which', make_which(*which))
        monkeypatch.setattr(driver, '_kms_display_active', lambda: kms)
        monkeypatch.setattr(
            driver,
            '_find_x_authority',
            lambda: str(authority) if authority else None,
        )
        instance = driver.DisplayDriver(
            config,
            status_callback=status_callback,
            sysfs_root=str(tmp_path),
        )
        instances.append(instance)
        return instance

    yield factory
    for instance in instances:
        instance.shutdown()


def test_percent_raw_mapping():
    assert driver.percent_to_raw(50, 255) == 128
    assert driver.percent_to_raw(0, 255) == 0
    assert driver.percent_to_raw(100, 255) == 255
    assert driver.percent_to_raw(150, 255) == 255
    assert driver.raw_to_percent(255, 255) == 100
    assert driver.raw_to_percent(0, 255) == 0
    assert driver.raw_to_percent(128, 255) == 50
    assert driver.raw_to_percent(0, 0) == 0


def test_sysfs_auto_detect_and_override(tmp_path):
    make_backlight(tmp_path, 'first')
    make_backlight(tmp_path, 'second', max_brightness=100)

    auto = driver.SysfsBacklight('', sysfs_root=str(tmp_path))
    assert auto.available is True
    assert auto.device == 'first'
    assert auto.max_brightness == 255

    override = driver.SysfsBacklight('second', sysfs_root=str(tmp_path))
    assert override.available is True
    assert override.device == 'second'
    assert override.max_brightness == 100


def test_sysfs_stale_override_falls_back(tmp_path):
    make_backlight(tmp_path, 'panel')

    backlight = driver.SysfsBacklight('missing', sysfs_root=str(tmp_path))

    assert backlight.available is True
    assert backlight.device == 'panel'
    assert backlight.stale_override is True


def test_sysfs_write_and_read(tmp_path):
    path = make_backlight(tmp_path, 'panel', max_brightness=255, brightness=50)

    backlight = driver.SysfsBacklight('', sysfs_root=str(tmp_path))
    backlight.set_percent(20)

    assert (path / 'brightness').read_text(encoding='ascii').strip() == '51'
    assert backlight.get_percent() == 20


@pytest.mark.skipif(os.geteuid() == 0, reason='root bypasses file permissions')
def test_sysfs_permission_fallback(tmp_path, monkeypatch):
    path = make_backlight(tmp_path, 'panel')
    (path / 'brightness').chmod(0o444)
    calls = []

    def run(args, timeout, input_text=None, env=None):
        calls.append((args, input_text))
        return Result()

    monkeypatch.setattr(driver, '_run_command', run)
    backlight = driver.SysfsBacklight('', sysfs_root=str(tmp_path))
    backlight.set_percent(40)

    assert calls
    assert calls[0][0][:3] == ['sudo', '-n', 'tee']
    assert calls[0][1] == '102\n'


def test_ddc_parse_formats():
    assert driver.DdcBrightness._parse(
        'VCP code 0x10 (Brightness): current value = 50, max value = 100'
    ) == (50, 100)
    assert driver.DdcBrightness._parse(
        'current value = 128\nmax value = 255'
    ) == (128, 255)
    assert driver.DdcBrightness._parse('current value = 50') == (50, 100)
    assert driver.DdcBrightness._parse('Display not found') is None


def test_ddc_probe_set_and_power(monkeypatch):
    calls = []

    def run(args, timeout, input_text=None, env=None):
        calls.append(list(args))
        if args[:3] == ['ddcutil', '-d', '1'] and args[3:] == ['getvcp', '10']:
            return Result('current value = 50, max value = 100')
        if args[:3] == ['ddcutil', '-d', '1'] and args[3:] == ['getvcp', 'd6']:
            return Result('current value = 1, max value = 4')
        return Result()

    monkeypatch.setattr(driver, '_run_command', run)
    ddc = driver.DdcBrightness(1, 'auto')

    assert ddc.probe() is True
    assert ddc.get_percent() == 50
    assert ddc.probe_power() is True
    ddc.set_percent(30)
    ddc.set_power(False)
    ddc.set_power(True)

    assert ['ddcutil', '-d', '1', 'setvcp', '10', '30'] in calls
    assert ['ddcutil', '-d', '1', 'setvcp', 'd6', '4'] in calls
    assert ['ddcutil', '-d', '1', 'setvcp', 'd6', '1'] in calls


def test_ddc_failure_raises(monkeypatch):
    monkeypatch.setattr(driver, '_run_command', lambda *args, **kwargs: None)
    ddc = driver.DdcBrightness(1, 'auto')

    assert ddc.probe() is False
    with pytest.raises(RuntimeError, match=driver.ERROR_NO_DDC):
        ddc.set_percent(50)
    with pytest.raises(RuntimeError, match=driver.ERROR_NO_DDC):
        ddc.set_power(False)


def test_x11_probe_gamma_and_power(tmp_path, monkeypatch):
    authority = tmp_path / 'serverauth'
    authority.write_text('', encoding='ascii')
    x11 = FakeX11()
    monkeypatch.setattr(driver, '_run_command', x11)
    monkeypatch.setattr(driver.shutil, 'which', make_which('xset', 'xrandr'))
    control = driver.X11Control(
        environ={'DISPLAY': ':0', 'XAUTHORITY': str(authority)},
    )

    assert control.probe() is True
    assert control.output == 'HDMI-1'
    assert control.get_percent() == 40
    control.set_percent(40)
    control.set_power(False)
    control.set_power(True)

    assert x11.calls_with(['xrandr', '--output', 'HDMI-1', '--brightness']) == [
        ['xrandr', '--output', 'HDMI-1', '--brightness', '0.40'],
    ]
    assert x11.calls_with(['xset', 'dpms', 'force', 'off'])
    assert x11.calls_with(['xset', 'dpms', 'force', 'on'])
    assert x11.calls_with(['xset', '-dpms'])


def test_x11_output_missing(tmp_path, monkeypatch):
    authority = tmp_path / 'serverauth'
    authority.write_text('', encoding='ascii')
    x11 = FakeX11(query='disconnected')
    monkeypatch.setattr(driver, '_run_command', x11)
    monkeypatch.setattr(driver.shutil, 'which', make_which('xset', 'xrandr'))
    control = driver.X11Control(
        environ={'DISPLAY': ':0', 'XAUTHORITY': str(authority)},
    )

    assert control.probe() is False
    assert control.output_missing is True


def test_resolution_prefers_sysfs(make_driver, tmp_path):
    make_backlight(tmp_path, 'panel')
    instance = make_driver(
        {'ddc_control': 'off', 'x11_control': 'off'},
        make_runner(),
        which=('vcgencmd',),
        kms=False,
    )

    assert instance.brightness_source == 'sysfs'
    assert instance.power_path == 'vcgencmd'
    assert instance.max_brightness == 255
    assert instance.backlight_device == 'panel'
    assert instance.resolve_standby_mechanic() == 'backlight'
    assert instance.get_status()['dim_available'] is True


def test_resolution_ddc_fallback(make_driver):
    instance = make_driver(
        {'ddc_control': 'auto', 'x11_control': 'off'},
        make_runner(
            ddc_brightness='current value = 50, max value = 100',
            ddc_power=True,
        ),
        which=(),
        kms=True,
    )

    assert instance.brightness_source == 'ddc'
    assert instance.power_path == 'ddc'
    assert instance.max_brightness is None
    assert instance.backlight_device == ''
    assert instance.resolve_standby_mechanic() == 'backlight'


def test_resolution_x11_fallback(make_driver, tmp_path):
    authority = tmp_path / 'serverauth'
    authority.write_text('', encoding='ascii')
    x11 = FakeX11()
    instance = make_driver(
        {'ddc_control': 'auto', 'x11_control': 'auto'},
        make_runner(x11=x11),
        which=('xset', 'xrandr'),
        kms=True,
        authority=authority,
    )

    assert instance.brightness_source == 'x11'
    assert instance.power_path == 'x11'
    assert instance.max_brightness is None
    assert instance.backlight_device == ''
    assert instance.resolve_standby_mechanic() == 'power_off'
    assert instance.get_status()['dim_available'] is True


def test_resolution_vcgencmd_only(make_driver):
    instance = make_driver(
        {'ddc_control': 'off', 'x11_control': 'off'},
        make_runner(),
        which=('vcgencmd',),
        kms=False,
    )

    assert instance.brightness_source is None
    assert instance.power_path == 'vcgencmd'
    assert instance.resolve_standby_mechanic() == 'power_off'
    status = instance.get_status()
    assert status['dim_available'] is False
    assert driver.ERROR_NO_BACKLIGHT in status['errors']
    assert driver.ERROR_NO_CONTROL not in status['errors']


def test_resolution_no_control_on_kms(make_driver):
    instance = make_driver(
        {'ddc_control': 'off', 'x11_control': 'off'},
        make_runner(),
        which=('vcgencmd',),
        kms=True,
    )

    assert instance.brightness_source is None
    assert instance.power_path is None
    assert instance.resolve_standby_mechanic() is None
    assert driver.ERROR_NO_CONTROL in instance.get_status()['errors']


def test_resolution_ddc_forced_with_sysfs(make_driver, tmp_path):
    make_backlight(tmp_path, 'panel')
    instance = make_driver(
        {'ddc_control': 'on', 'x11_control': 'off'},
        make_runner(ddc_brightness='current value = 50, max value = 100'),
        which=(),
        kms=True,
    )

    assert instance.brightness_source == 'ddc'
    assert instance.max_brightness is None
    assert instance.backlight_device == ''


def test_mechanic_forced_power_off_falls_back_to_backlight(make_driver, tmp_path):
    make_backlight(tmp_path, 'panel')
    instance = make_driver(
        {
            'ddc_control': 'off',
            'x11_control': 'off',
            'standby_mechanic': 'power_off',
        },
        make_runner(),
        which=(),
        kms=True,
    )

    assert instance.power_path is None
    assert instance.resolve_standby_mechanic() == 'backlight'


def test_mechanic_forced_backlight_without_source(make_driver):
    instance = make_driver(
        {
            'ddc_control': 'off',
            'x11_control': 'off',
            'standby_mechanic': 'backlight',
        },
        make_runner(),
        which=('vcgencmd',),
        kms=False,
    )

    assert instance.resolve_standby_mechanic() is None


def test_worker_coalesces_and_publishes_busy(make_driver, tmp_path):
    make_backlight(tmp_path, 'panel')
    statuses = []
    holder = {}

    def publish():
        statuses.append(holder['driver'].get_status())

    instance = make_driver(
        {'ddc_control': 'off', 'x11_control': 'off'},
        make_runner(),
        which=(),
        kms=True,
        status_callback=publish,
    )
    holder['driver'] = instance
    started = threading.Event()
    release = threading.Event()
    done = threading.Event()
    written = []

    def fake_set(percent):
        written.append(percent)
        if len(written) == 1:
            started.set()
            release.wait(2)
        else:
            done.set()

    instance.backlight.set_percent = fake_set
    instance.set_percent(10)
    assert started.wait(2)
    instance.set_percent(20)
    instance.set_percent(30)
    release.set()
    assert done.wait(2)
    wait_idle(instance)

    assert written == [10, 30]
    assert any(status['busy'] for status in statuses)
    assert statuses[-1]['busy'] is False


def test_worker_error_clears_on_success(make_driver, tmp_path):
    make_backlight(tmp_path, 'panel')
    published = threading.Event()
    failed = threading.Event()
    holder = {}

    def publish():
        status = holder['driver'].get_status()
        if driver.ERROR_NO_BACKLIGHT in status['errors']:
            failed.set()
        elif failed.is_set():
            published.set()

    instance = make_driver(
        {'ddc_control': 'off', 'x11_control': 'off'},
        make_runner(),
        which=(),
        kms=True,
        status_callback=publish,
    )
    holder['driver'] = instance
    failing = {'enabled': True}

    def fake_set(percent):
        if failing['enabled']:
            raise RuntimeError(driver.ERROR_NO_BACKLIGHT)

    instance.backlight.set_percent = fake_set
    instance.set_percent(50)
    assert failed.wait(2)
    assert driver.ERROR_NO_BACKLIGHT in instance.get_status()['errors']

    failing['enabled'] = False
    instance.set_percent(60)
    assert published.wait(2)
    assert driver.ERROR_NO_BACKLIGHT not in instance.get_status()['errors']


def test_power_off_backlight(make_driver, tmp_path):
    make_backlight(tmp_path, 'panel')
    instance = make_driver(
        {
            'brightness': 80,
            'ddc_control': 'off',
            'x11_control': 'off',
        },
        make_runner(),
        which=(),
        kms=True,
    )
    written = []
    instance.backlight.set_percent = written.append

    instance.set_power(False)
    wait_idle(instance)
    instance.set_power(True)
    wait_idle(instance)

    assert written == [0, 80]


def test_power_off_x11(make_driver, tmp_path):
    authority = tmp_path / 'serverauth'
    authority.write_text('', encoding='ascii')
    x11 = FakeX11()
    instance = make_driver(
        {
            'brightness': 70,
            'ddc_control': 'auto',
            'x11_control': 'auto',
        },
        make_runner(x11=x11),
        which=('xset', 'xrandr'),
        kms=True,
        authority=authority,
    )

    instance.set_power(False)
    wait_idle(instance)
    assert x11.calls_with(['xset', 'dpms', 'force', 'off'])

    instance.set_power(True)
    wait_idle(instance)
    assert x11.calls_with(['xset', 'dpms', 'force', 'on'])
    assert x11.calls_with(['xset', '-dpms'])
    assert x11.calls_with(['xrandr', '--output', 'HDMI-1', '--brightness']) == [
        ['xrandr', '--output', 'HDMI-1', '--brightness', '0.70'],
    ]


def test_apply_initial_x11(make_driver, tmp_path):
    authority = tmp_path / 'serverauth'
    authority.write_text('', encoding='ascii')
    x11 = FakeX11()
    instance = make_driver(
        {'ddc_control': 'auto', 'x11_control': 'auto'},
        make_runner(x11=x11),
        which=('xset', 'xrandr'),
        kms=True,
        authority=authority,
    )

    instance.apply_initial(70)

    assert x11.calls_with(['xset', 'dpms', 'force', 'on'])
    assert x11.calls_with(['xset', '-dpms'])
    assert x11.calls_with(['xrandr', '--output', 'HDMI-1', '--brightness']) == [
        ['xrandr', '--output', 'HDMI-1', '--brightness', '0.70'],
    ]


def test_vcgencmd_kms_rule(monkeypatch):
    monkeypatch.setattr(driver.shutil, 'which', make_which('vcgencmd'))
    monkeypatch.setattr(driver, '_kms_display_active', lambda: True)
    assert driver.VcgencmdPower().available is False

    monkeypatch.setattr(driver, '_kms_display_active', lambda: False)
    calls = []
    monkeypatch.setattr(
        driver,
        '_run_command',
        lambda args, timeout, input_text=None, env=None: calls.append(args) or Result(),
    )
    power = driver.VcgencmdPower()
    assert power.available is True
    power.set_power(False)
    power.set_power(True)
    assert calls == [
        ['/usr/bin/vcgencmd', 'display_power', '0'],
        ['/usr/bin/vcgencmd', 'display_power', '1'],
    ]
