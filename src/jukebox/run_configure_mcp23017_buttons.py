#!/usr/bin/env python
"""
Configure and diagnose the MCP23017 buttons.

The tool never starts the polling thread. ``--probe`` and ``--validate`` work
while the jukebox daemon is running; ``--test`` claims the configured lines and
therefore requires a stopped daemon.
"""

import argparse
import json
import logging
import os
import shutil
import sys
import time

import jukebox.cfghandler as cfghandler
import jukebox.rpc.client as rpc

from components.gpio.mcp23017.config import parse_config, pin_name
from components.gpio.mcp23017.ctrl import Ctrl, read_overlay
from components.gpio.mcp23017.device import (
    BackendError,
    LgpioBackend,
    LgpioChipProbe,
    detect_chip,
)
from components.rpc_command_alias import cmd_alias_definitions

SCRIPT_DIR = os.path.abspath(os.path.dirname(os.path.realpath(__file__)))
DEFAULT_CONFIG = os.path.abspath(os.path.join(SCRIPT_DIR, '../../shared/settings/mcp23017.yaml'))
EXAMPLE_CONFIG = os.path.abspath(os.path.join(SCRIPT_DIR,
                                              '../../resources/default-settings/'
                                              'mcp23017.example.yaml'))

logger = logging.getLogger('jb.mcp23017.tool')


def main(argv=None):
    parser = _argument_parser()
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbosity else logging.INFO,
                        format='%(levelname)s: %(message)s')
    if args.probe:
        return _probe(args)
    if args.validate:
        return _validate(args)
    if args.generate_config:
        return _generate_config(args)
    if args.test:
        return _monitor(args)
    return _test_button(args)


def _argument_parser():
    parser = argparse.ArgumentParser(description='Configure and diagnose MCP23017 buttons')
    parser.add_argument('--config', metavar='FILE', default=DEFAULT_CONFIG,
                        help=f"Device configuration [default: {DEFAULT_CONFIG}]")
    parser.add_argument('-v', '--verbosity', action='store_true', default=False,
                        help='Increase the logging level to DEBUG')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--probe', action='store_true',
                      help='Check chip, overlay, configured pins and permissions')
    mode.add_argument('--validate', action='store_true',
                      help='Load and validate the configuration without hardware access')
    mode.add_argument('--generate-config', action='store_true',
                      help='Write the example configuration to the configured path')
    mode.add_argument('--test', action='store_true',
                      help='Read-only pin monitor; requires a stopped jukebox daemon')
    mode.add_argument('--test-button', metavar='NAME',
                      help='Call the test action of one button through the RPC server')
    parser.add_argument('--execute', action='store_true', default=False,
                        help='With --test-button: run the action instead of simulating it')
    parser.add_argument('--force', action='store_true', default=False,
                        help='With --generate-config: overwrite an existing file; '
                             'with --test-button: allow host shutdown and reboot')
    return parser


def _load_config(path):
    if not os.path.isfile(path):
        raise FileNotFoundError(f"Configuration file not found: {path}")
    handler = cfghandler.ConfigHandler('mcp23017-tool')
    cfghandler.load_yaml(handler, path)
    return parse_config(handler)


def _resolve(config):
    ctrl = Ctrl()
    ctrl.load_config(config)
    ctrl.resolve_actions(cmd_alias_definitions)
    return ctrl.list_buttons()


def _validate(args):
    try:
        config = _load_config(args.config)
        buttons = _resolve(config)
    except Exception as error:
        print(f"ERROR: {error.__class__.__name__}: {error}")
        return 1
    print(f'Configuration: {args.config}')
    print(f"  bus: {config.bus}")
    print(f"  address: {config.address_hex}")
    print(f"  chip: {'auto' if config.chip is None else config.chip}")
    print(f"  poll interval: {config.poll_interval_ms} ms")
    valid = 0
    for button in buttons:
        state = 'valid' if button['valid'] else f"invalid: {button['error']}"
        if button['valid']:
            valid += 1
        targets = ', '.join(f"{key} -> {_target_text(action)}"
                            for key, action in button['actions'].items())
        print(f"  {button['name']} ({pin_name(button['pin'])}, {button['type']}): "
              f"{state}{'; ' + targets if targets else ''}")
    print(f'  buttons: {valid} valid, {len(buttons) - valid} invalid')
    return 0 if valid else 1


def _target_text(action):
    target = action['target']
    suffix = f".{target['method']}" if target['method'] else ''
    return f"{target['package']}.{target['plugin']}{suffix} ({action['source']})"


def _probe(args):
    try:
        config = _load_config(args.config)
    except Exception as error:
        print(f"ERROR: {error.__class__.__name__}: {error}")
        return 1
    try:
        chip = detect_chip(config.bus, config.address, config.chip, LgpioChipProbe())
    except Exception as error:
        print(f"ERROR: {error.__class__.__name__}: {error}")
        return 1
    print(f"gpiochip: {chip}")
    print(f"I2C bus: {config.bus}, address: {config.address_hex}")
    _print_permissions(f'/dev/i2c-{config.bus}', os.R_OK | os.W_OK)
    _print_permissions(f'/dev/gpiochip{chip}', os.R_OK | os.W_OK)
    try:
        backend = LgpioBackend(chip, config.bus, config.address, [])
        iocon = backend.read_iocon()
        gppu = backend.read_gppu()
        print(f'IOCON: 0x{iocon:02x}' + (' (BANK=1!)' if iocon & 0x80 else ''))
        print(f'GPPU: 0x{gppu:04x} (expected 0x{config.gppu_mask:04x})')
    except BackendError as error:
        print(f'ERROR: {error}')
        return 1
    overlay = read_overlay(config)
    if overlay is None:
        print('overlay: no mcp23017 line in the boot configuration')
    else:
        print(f"overlay: {overlay['path']}:{overlay['line']}, "
              f"address {overlay['address']}, bus {overlay['bus']}, "
              f"noints {overlay['noints']}, match {overlay['match']}")
    buttons = _resolve(config)
    print(f"buttons: {sum(1 for button in buttons if button['valid'])} valid, "
          f"{sum(1 for button in buttons if not button['valid'])} invalid")
    return 0


def _generate_config(args):
    target = os.path.abspath(args.config)
    if os.path.exists(target) and not args.force:
        print(f"ERROR: '{target}' already exists; use --force to overwrite it")
        return 1
    os.makedirs(os.path.dirname(target), exist_ok=True)
    shutil.copyfile(EXAMPLE_CONFIG, target)
    print(f'Wrote {target}')
    return 0


def _monitor(args):
    try:
        config = _load_config(args.config)
    except Exception as error:
        print(f"ERROR: {error.__class__.__name__}: {error}")
        return 1
    try:
        chip = detect_chip(config.bus, config.address, config.chip, LgpioChipProbe())
        backend = LgpioBackend(chip, config.bus, config.address,
                               [button.pin for button in config.valid_buttons])
        backend.open()
    except Exception as error:
        print(f"ERROR: {error.__class__.__name__}: {error}")
        return 1
    print('Reading the configured pins; press a button and stop with Ctrl-C.')
    last = {}
    try:
        while True:
            for button in config.valid_buttons:
                value = backend.read_pin(button.pin)
                if last.get(button.pin) != value:
                    last[button.pin] = value
                    print(f"{button.name} ({pin_name(button.pin)}): {value}")
            time.sleep(0.05)
    except KeyboardInterrupt:
        print('\nStopped.')
    finally:
        backend.close()
    return 0


def _test_button(args):
    client = rpc.RpcClient('tcp://localhost:5555')
    try:
        result = client.enque('mcp23017', 'ctrl', 'test_button',
                              args=[args.test_button],
                              kwargs={'execute': args.execute, 'force': args.force})
    except Exception as error:
        print(f'ERROR: {error.__class__.__name__}: {error}')
        return 1
    print(json.dumps(result, indent=2, default=str))
    return 0


def _print_permissions(path, mode):
    if not os.path.exists(path):
        print(f'{path}: missing')
    else:
        print(f'{path}: ' + ('read/write' if os.access(path, mode) else 'not accessible'))


if __name__ == '__main__':
    sys.exit(main())
