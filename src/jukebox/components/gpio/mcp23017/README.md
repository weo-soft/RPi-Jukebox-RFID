# MCP23017 buttons

Button support for an Adafruit MCP23017 I2C GPIO expander. The expander is
driven by the kernel driver through the `mcp23017` device-tree overlay, so its
16 lines appear as an additional `gpiochip`. The plugin reads the lines through
that chip and writes the internal pull-ups directly to the `GPPU` registers.

## Files

| File | Purpose |
| --- | --- |
| `plugin.py` | Plugin lifecycle: configuration, hardware setup, polling thread |
| `ctrl.py` | Control object registered as `mcp23017.ctrl` (status, diagnostics) |
| `config.py` | YAML loading and validation |
| `device.py` | Chip detection, `lgpio` reads and `GPPU` access over I2C |
| `buttons.py` | Debouncing and the per-button state machine |
| `actions.py` | RPC alias/command parsing, resolution and binding |

## Configuration

The module is enabled in `shared/settings/jukebox.yaml`:

```yaml
modules:
  named:
    mcp23017: gpio.mcp23017.plugin

mcp23017:
  enable: true
  config_file: ../../shared/settings/mcp23017.yaml
```

The device file holds `bus`, `address`, `chip`, `poll_interval_ms` and a
`buttons` mapping. Each button has `pin`, `type`, `active_low`, `pull_up`,
`debounce_ms`, an optional `hold_ms` and one or more `actions`. The button types
are `momentary`, `long_press`, `short_long_press` and `hold_repeat`.

## Lifecycle

- `initialize` registers the control object first, then loads the configuration,
  resolves the RPC aliases, detects the gpiochip, claims the configured lines
  and writes the `GPPU` mask.
- `finalize` binds the actions to callables and starts the `mcp23017-poll`
  thread.
- `atexit` stops and joins the thread, frees the lines, closes the chip and
  detaches the backend.

A configuration or hardware error disables the plugin with a message in
`mcp23017.ctrl.get_status()`; the jukebox daemon keeps running.

## Pull-ups

The kernel pin configuration path does not reach the pinconf of this driver, so
`pull_up: internal` is implemented by writing the `GPPU` registers with
`i2cset -f` and verifying them with `i2cget -f`. The kernel register cache does
not see these writes; `gpioinfo` therefore does not reflect the pull-ups.

## Tests

The tests use a fake backend, a fake chip probe and a fake clock. They do not
import `lgpio`, so they run on a machine without the expander.
