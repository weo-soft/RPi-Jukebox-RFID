# MCP23017 buttons

The Adafruit MCP23017 I2C GPIO expander adds 16 inputs to a Phoniebox. The
kernel driver exposes them as an additional `gpiochip`, and the `mcp23017`
plugin turns them into buttons with configurable actions.

The plugin is meant for momentary push buttons such as play/pause, next,
previous and volume. Latching switches are not supported.

## Wiring

Each button connects one contact to the expander line (`GPA0`-`GPA7` or
`GPB0`-`GPB7`) and the other contact to `GND`. The plugin enables the internal
pull-ups of the MCP23017, so no external resistors are needed.

- Power the breakout from `3V3`, not from `5V`. The I2C pull-ups of the board
  reference `VIN`, and 5 V on `SDA`/`SCL` is not safe for the Raspberry Pi.
- The address is selected with the `A0`/`A1`/`A2` jumpers. The default is
  `0x20`; the range is `0x20`-`0x27`.
- The `noints` overlay option keeps `GPIO4` free. The breakout does not wire
  the interrupt line by default, and the plugin polls instead.

## Installation

The installer asks whether MCP23017 buttons should be supported. When
answered with `y`, it also asks for the I2C address and the I2C bus. The
routine then:

1. enables the I2C interface (`dtparam=i2c_arm=on`) and loads `i2c-dev`,
2. adds the overlay block `dtoverlay=mcp23017,addr=0x20,noints,i2c1` to the
   boot configuration (once, with a backup),
3. installs `i2c-tools`,
4. adds the service user to the groups `i2c` and `gpio`,
5. creates `shared/settings/mcp23017.yaml` from the example, and
6. enables the module in `shared/settings/jukebox.yaml`.

The changes to the boot configuration, the group membership and the overlay
need a reboot. `i2cdetect -y 1` then shows `UU` at `0x20`, which means the
kernel driver is bound.

### Existing installation

The installer does not run over an existing installation. Migrate manually:

1. Back up the boot configuration and the main settings:

   ```bash
   sudo cp /boot/firmware/config.txt /boot/firmware/config.txt.bak
   cp shared/settings/jukebox.yaml shared/settings/jukebox.yaml.bak
   ```

2. Enable I2C and add the overlay block to the boot configuration:

   ```text
   [all]
   dtparam=i2c_arm=on
   # MCP23017 I2C GPIO expander
   dtoverlay=mcp23017,addr=0x20,noints,i2c1
   ```

3. Load `i2c-dev`:

   ```bash
   echo i2c-dev | sudo tee /etc/modules-load.d/i2c-dev.conf
   ```

4. Install `i2c-tools` and add the service user to the groups:

   ```bash
   sudo apt install i2c-tools
   sudo groupadd -f i2c
   sudo groupadd -f gpio
   sudo usermod -aG i2c,gpio "$USER"
   ```

5. Create the device configuration from the example and adapt `bus` and
   `address`:

   ```bash
   cp resources/default-settings/mcp23017.example.yaml shared/settings/mcp23017.yaml
   ```

6. Add the module and the section to `shared/settings/jukebox.yaml`:

   ```yaml
   modules:
     named:
       # ... existing modules ...
       mcp23017: gpio.mcp23017.plugin

   mcp23017:
     enable: true
     config_file: ../../shared/settings/mcp23017.yaml
   ```

7. If a service or script already writes the `GPPU` registers, disable it.
   The plugin is the only component that may write them:

   ```bash
   unit=$(systemctl list-unit-files --type=service --no-legend | awk '/mcp23017/ {print $1; exit}')
   [ -n "$unit" ] && sudo systemctl disable --now "$unit"
   ```

8. Reboot and restart the service:

   ```bash
   sudo reboot
   systemctl --user restart jukebox-daemon
   ```

9. Check the result with `mcp23017.ctrl.get_status` and
   `run_configure_mcp23017_buttons.py --probe`.

## Configuration

The device settings and the buttons live in `shared/settings/mcp23017.yaml`:

| Key | Meaning |
| --- | --- |
| `bus` | I2C bus number (0-6), usually `1` |
| `address` | I2C address `0x20`-`0x27`; integers and strings are accepted |
| `chip` | `auto` or a fixed `gpiochip` number |
| `poll_interval_ms` | Polling interval 10-1000 ms, default 25 |
| `buttons` | Mapping of button name to button definition |

Each button supports:

| Key | Meaning |
| --- | --- |
| `pin` | `GPA0`-`GPA7`, `GPB0`-`GPB7` or a line number 0-15 |
| `type` | `momentary`, `long_press`, `short_long_press`, `hold_repeat` |
| `active_low` | `true` (default) when the button pulls to `GND` |
| `pull_up` | `internal` (default), `external` or `none` |
| `debounce_ms` | Minimum stable time; at least `poll_interval_ms` |
| `hold_ms` | Required for the long and repeat types |
| `actions` | Action per event, as an RPC alias or a full RPC command |

### Button types

| Type | Action keys | Behaviour |
| --- | --- | --- |
| `momentary` | `on_press` | One action per press |
| `long_press` | `on_long_press` | One action when `hold_ms` is reached |
| `short_long_press` | `on_short_press`, `on_long_press` | Short action on release before `hold_ms`, long action at `hold_ms` |
| `hold_repeat` | `on_press` | Immediate action, then every `hold_ms` while held |

`on_press` is the playback action for a `momentary` button. It is not a
button type; toggling playback is the RPC alias `toggle`.

### Actions

An action is either an RPC alias or a full RPC command:

```yaml
actions:
  on_press:
    alias: change_volume
    args: [2]
```

```yaml
actions:
  on_press:
    package: player
    plugin: ctrl
    method: next
    args: []
    kwargs: {}
```

`alias` and the full command are mutually exclusive; `alias` wins if both are
given. The available aliases are listed in
[RPC commands](rpc-commands.md#aliases).

### Example

`resources/default-settings/mcp23017.example.yaml` contains a five button
media layout on `GPA0`-`GPA4`:

```yaml
bus: 1
address: 0x20
chip: auto
poll_interval_ms: 25
buttons:
  play_pause:
    pin: GPA0
    type: momentary
    active_low: true
    pull_up: internal
    debounce_ms: 30
    actions:
      on_press:
        alias: toggle

  volume_up:
    pin: GPA3
    type: hold_repeat
    active_low: true
    pull_up: internal
    debounce_ms: 30
    hold_ms: 500
    actions:
      on_press:
        alias: change_volume
        args: [2]
```

The other pins are free; the assignment is not fixed in code.

## Pull-ups

The kernel driver does not expose a working bias request for this chip. The
plugin therefore writes the `GPPU` registers with `i2cset -f` and verifies
them with `i2cget -f`. The kernel keeps its own register cache, so `gpioinfo`
does not show the pull-ups and is not a valid check.

```bash
i2cget -f -y 1 0x20 0x0c   # GPPUA, 0x1f for GPA0-GPA4
i2cget -f -y 1 0x20 0x0d   # GPPUB
```

If the expander loses power, the pull-ups are lost until the plugin writes
them again on the next start or after a polling error.

## Status and diagnostics

The plugin exposes three RPC methods:

```bash
tools/run_rpc_tool.sh -c mcp23017.ctrl.get_status
tools/run_rpc_tool.sh -c mcp23017.ctrl.list_buttons
tools/run_rpc_tool.sh -c "mcp23017.ctrl.test_button play_pause"
```

`test_button` simulates an action by default. `execute` runs it, and `force`
is required for `host.shutdown` and `host.reboot`. The RPC command line tool
cannot pass keyword arguments; use the diagnostics tool or the HTTP API:

```bash
tools/run_configure_mcp23017_buttons.sh --test-button play_pause --execute
```

```bash
curl -s -X POST http://127.0.0.1:5556/api/v1/rpc \
  -H 'Content-Type: application/json' \
  -d '{"package":"mcp23017","plugin":"ctrl","method":"test_button",
       "args":["play_pause"],"kwargs":{"execute":true}}'
```

The diagnostics tool:

| Flag | Purpose |
| --- | --- |
| `--validate` | Load and validate the configuration, no hardware access |
| `--probe` | Check chip, overlay, `GPPU` and permissions; no lines are claimed |
| `--generate-config` | Write the example configuration; `--force` overwrites |
| `--test` | Read-only pin monitor; requires a stopped daemon |
| `--test-button NAME` | Call the test action through the RPC server |

## Troubleshooting

- **No gpiochip with 16 lines** - check that `dtparam=i2c_arm=on` and the
  overlay are in the boot configuration, then reboot. `i2cdetect -y 1` must
  show `UU` at the configured address.
- **`mcp23017.ctrl.get_status` reports `error`** - the `last_error` field and
  the journal of the service give the reason. A missing configuration file,
  an unreachable expander or a failed `GPPU` write disables the plugin
  without stopping the daemon.
- **`GPPU` readback differs from the mask** - another service may write the
  registers. Stop it and restart the jukebox service.
- **Permission denied on `/dev/i2c-1` or `/dev/gpiochipN`** - the service
  user must be in the groups `i2c` and `gpio`; a new login or a reboot is
  required after the change.
- **A button triggers twice or not at all** - raise `debounce_ms` above the
  polling interval, and check `active_low` and the wiring (`NO` contact to
  `GND`).
- **Changes to the configuration** - restart the service:
  `systemctl --user restart jukebox-daemon`.

## Limitations

- Polling only; the interrupt line is not used.
- One expander per installation.
- Actions run in the polling thread. A long action delays all buttons; keep
  the actions short.
- Latching switches and the power button of the PowerBlock are not part of
  this feature.

## Rollback

1. Set `mcp23017.enable` to `false` in `shared/settings/jukebox.yaml`; the
   module entry may stay.
2. Remove `shared/settings/mcp23017.yaml` or leave it in place.
3. Remove the overlay block and `dtparam=i2c_arm=on` from the boot
   configuration, or restore the backup. Remove
   `/etc/modules-load.d/i2c-dev.conf` if it was only added for this feature.
4. Remove the groups `i2c` and `gpio` only if they were added for this
   feature alone.
5. Re-enable a previously disabled `GPPU` service if needed.
6. Restart the service; `get_status` then reports `disabled`.
