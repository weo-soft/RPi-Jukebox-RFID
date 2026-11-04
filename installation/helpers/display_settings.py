#!/usr/bin/env python3
"""Write initial display settings into a ``jukebox.yaml`` file.

The helper only fills an empty ``display.backlight_device`` when exactly one
sysfs device exists.  Existing values, all other keys and the file's comments
are left untouched.  ``ddc_control`` is never written.
"""

import os
import sys
from pathlib import Path

from ruamel.yaml import YAML
from ruamel.yaml.comments import CommentedMap

BACKLIGHT_ROOT = Path(
    os.environ.get('DISPLAY_BACKLIGHT_ROOT', '/sys/class/backlight'),
)

EXIT_OK = 0
EXIT_ERROR = 1
EXIT_NO_DEVICE = 2


def backlight_devices():
    """Return the names of the backlight devices as a sorted list."""
    try:
        return sorted(
            path.name for path in BACKLIGHT_ROOT.iterdir() if path.is_dir()
        )
    except FileNotFoundError:
        return []


def load_settings(path):
    """Load a YAML file in round-trip mode."""
    yaml = YAML()
    yaml.preserve_quotes = True
    with path.open('r', encoding='utf-8') as handle:
        data = yaml.load(handle)
    if data is None:
        data = CommentedMap()
    return yaml, data


def write_settings(path, yaml, data):
    """Write the YAML data through a temporary file in the same directory."""
    temporary = path.with_name(f'{path.name}.tmp')
    with temporary.open('w', encoding='utf-8') as handle:
        yaml.dump(data, handle)
    os.replace(temporary, path)


def main(argv=None):
    """Run the probe and return the process exit code."""
    arguments = list(sys.argv[1:] if argv is None else argv)
    if len(arguments) != 1:
        print('usage: display_settings.py <jukebox.yaml>', file=sys.stderr)
        return EXIT_ERROR
    path = Path(arguments[0])
    try:
        yaml, data = load_settings(path)
        display = data.get('display')
        if display is None:
            display = CommentedMap()
            data['display'] = display
        if not isinstance(display, dict):
            print('display section is not a mapping', file=sys.stderr)
            return EXIT_ERROR

        current = display.get('backlight_device', '')
        if current:
            print('backlight_device already set; leaving it unchanged')
            return EXIT_OK

        devices = backlight_devices()
        if not devices:
            print('no backlight device found; backlight_device stays empty')
            return EXIT_NO_DEVICE
        if len(devices) > 1:
            print('multiple backlight devices found; backlight_device stays empty')
            return EXIT_OK

        display['backlight_device'] = devices[0]
        write_settings(path, yaml, data)
        print(f'backlight_device set to {devices[0]}')
        return EXIT_OK
    except Exception as error:
        print(f'could not update {path}: {error}', file=sys.stderr)
        return EXIT_ERROR


if __name__ == '__main__':
    sys.exit(main())
