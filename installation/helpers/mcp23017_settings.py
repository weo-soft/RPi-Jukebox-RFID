# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder
"""
Update the MCP23017 settings during installation.

The installer calls this helper instead of editing YAML with sed, so comments
and the surrounding structure are preserved.
"""

import os
import sys

from ruamel.yaml import YAML
from ruamel.yaml.scalarint import HexInt


def set_device_settings(path, bus, address):
    """Write the I2C bus and address into the device configuration file."""
    data = _load(path)
    data['bus'] = int(bus)
    data['address'] = HexInt(int(address, 0))
    _store(path, data)
    reloaded = _load(path)
    if reloaded.get('bus') != int(bus) or int(reloaded.get('address')) != int(address, 0):
        raise RuntimeError(f'Writing the device settings to {path} failed')


def enable_module(path):
    """Enable the mcp23017 module in jukebox.yaml without changing gpioz."""
    data = _load(path)
    gpioz_before = _gpioz_enable(data)
    section = data.get('mcp23017')
    if section is None:
        section = data['mcp23017'] = {}
    section['enable'] = True
    if _gpioz_enable(data) != gpioz_before:
        raise RuntimeError("'gpioz.enable' must not change")
    _store(path, data)
    reloaded = _load(path)
    if reloaded.get('mcp23017', {}).get('enable') is not True:
        raise RuntimeError(f'Enabling mcp23017 in {path} failed')
    if _gpioz_enable(reloaded) != gpioz_before:
        raise RuntimeError("'gpioz.enable' changed while writing the file")


def _gpioz_enable(data):
    section = data.get('gpioz')
    return section.get('enable') if section is not None else None


def _load(path):
    yaml = YAML(typ='rt')
    with open(path, encoding='utf-8') as stream:
        return yaml.load(stream) or {}


def _store(path, data):
    yaml = YAML(typ='rt')
    temporary = path + '.tmp'
    with open(temporary, 'w', encoding='utf-8') as stream:
        yaml.dump(data, stream)
    _load(temporary)
    os.replace(temporary, path)


def main(argv):
    if len(argv) < 3:
        print('usage: mcp23017_settings.py device FILE BUS ADDRESS | module FILE',
              file=sys.stderr)
        return 2
    command, path = argv[1], argv[2]
    if command == 'device':
        if len(argv) != 5:
            print('usage: mcp23017_settings.py device FILE BUS ADDRESS', file=sys.stderr)
            return 2
        set_device_settings(path, argv[3], argv[4])
    elif command == 'module':
        if len(argv) != 3:
            print('usage: mcp23017_settings.py module FILE', file=sys.stderr)
            return 2
        enable_module(path)
    else:
        print(f'unknown command: {command}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv))
