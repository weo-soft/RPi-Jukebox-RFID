# Display Plugin

The `display` plugin controls the brightness and the power state of the
connected display. It exposes its settings through the Web App, resets an
inactivity timer on user interaction and publishes its state as
`display.status`.

## Module layout

The plugin is a Python package under `src/jukebox/components/display/`:

| File | Responsibility |
| --- | --- |
| `__init__.py` | RPC facade, lifecycle, configuration defaults, status publishing |
| `driver.py` | Brightness sources (sysfs, DDC/CI, X11 gamma), power paths (`vcgencmd`, DDC/CI, X11 DPMS), write worker |
| `state_machine.py` | `active` / `dimmed` / `standby`, the two absolute inactivity deadlines, music modes, persistence |
| `activity.py` | RFID scans, touch, configured buttons and the Web App ping |

It is loaded through `modules.named` in `jukebox.default.yaml`:

```yaml
modules:
  named:
    publishing: publishing
    player: player.plugin
    rfid: rfid.reader
    display: display
```

The plugin must be loaded after `publishing`, `player` and `rfid`: the
subscriber connects to the in-process publishing proxy and the plugin reads
the initial player status during initialization.

## Configuration

The complete section is defined in
`resources/default-settings/jukebox.default.yaml` and can be overridden in
`shared/settings/jukebox.yaml`:

```yaml
display:
  backlight_device: ""
  ddc_control: auto
  ddc_display: 1
  x11_control: auto
  x11_output: ""
  brightness: 100
  dim_brightness: 10
  dim_timeout_min: 2
  standby_timeout_min: 5
  standby_mechanic: auto
  music_mode: normal
  touch_device: ""
  button_devices: []
```

`backlight_device`, `ddc_control`, `ddc_display`, `x11_control`,
`x11_output`, `touch_device` and `button_devices` are read at initialization.
The remaining values are also persisted by their RPC setters.

### Capability resolution

The driver resolves one brightness source and one power path once at
startup. Hardware is preferred; X11 is the software fallback.

| Capability | Order |
| --- | --- |
| Brightness | sysfs, DDC/CI (`ddc_control: on` prefers DDC even with sysfs), X11 gamma, none |
| Power | `vcgencmd` outside KMS, DDC/CI `getvcp d6`, X11 DPMS, none |
| `standby_mechanic: auto` | `backlight` for sysfs/DDC, otherwise `power_off` if a power path exists |

`vcgencmd display_power` is deliberately not used when the `vc4` KMS driver
owns the display (`/sys/module/vc4`): the firmware command exists but has no
effect there. Without a usable power path and without a brightness source the
status contains `no_display_control` and the Web App hides the controls.

`standby_mechanic` can force `backlight` or `power_off`. Forcing `backlight`
without a brightness source yields no control. Forcing `power_off` without a
power path falls back to brightness 0 when a source exists.

## RPC interface

The facade consists of module functions, so the RPC path is
`display.<function>` (`package=display`, `plugin=<function>`, no `method`).

| Call | Arguments | Return | Persists |
| --- | --- | --- | --- |
| `display.status` | — | status object | — |
| `display.set_brightness` | `percent` (1–100) | status | `brightness` |
| `display.set_dim_brightness` | `percent` (0–100) | status | `dim_brightness` |
| `display.set_timeouts` | `dim_min`, `standby_min` (0–1440 minutes) | status | `dim_timeout_min`, `standby_timeout_min` |
| `display.set_music_mode` | `mode` (`normal`, `on_while_playing`, `dim_while_playing`) | status | `music_mode` |
| `display.set_standby_mechanic` | `mechanic` (`auto`, `backlight`, `power_off`) | status | `standby_mechanic` |
| `display.set_power` | `on` (boolean) | status | — |
| `display.activity` | — | `null` | — |

`set_timeouts` rejects `0 < standby_min < dim_min`. A persisted value with
this ordering is raised to `dim_timeout_min` at load and logged.

`set_power` is not persisted: after a restart the display starts active with
the configured `brightness`.

Persisting setters use one `with cfg:` block around `setn` and
`cfg.save(only_if_changed=True)`. If saving fails, the previous value is
restored in memory and `config_save_failed` is raised.

When initialization failed, `status` still answers with
`errors: ["init_failed"]` and all setters raise `display_unavailable`.
`activity` remains callable and is ignored.

## Status object

```json
{
  "state": "active",
  "power": true,
  "brightness_percent": 100,
  "dim_brightness_percent": 10,
  "dim_timeout_min": 2,
  "standby_timeout_min": 5,
  "music_mode": "normal",
  "standby_mechanic": "auto",
  "standby_mechanic_active": "backlight",
  "brightness_source": "sysfs",
  "max_brightness": 255,
  "backlight_device": "rpi_backlight",
  "dim_available": true,
  "busy": false,
  "errors": []
}
```

- `power` is derived from `state`: it is `false` exactly in `standby`,
  including a `backlight` standby with brightness 0.
- `brightness_source` is `sysfs`, `ddc`, `x11` or `null`.
- `max_brightness` and `backlight_device` are only set for `sysfs`.
- `busy` is `true` while a write is queued or running.
- `errors` contains resolution errors, the last write error and input errors
  such as `no_input_access`.

## State machine

The machine has two absolute inactivity deadlines measured from the last
interaction. `dim_timeout_min: 2` and `standby_timeout_min: 5` mean five
minutes in total, not seven. Both timers are `GenericTimerClass` instances
and are always armed with `start(seconds, restart=True)`.

| State | Meaning |
| --- | --- |
| `active` | Panel on with `brightness_percent` |
| `dimmed` | Panel at `dim_brightness_percent` |
| `standby` | `backlight` writes brightness 0; `power_off` uses the resolved power path |

A timeout of `0` disables its stage. Both values at `0` disable automatic
control; the manual switch and brightness remain available.

Music modes only change whether a transition is allowed while
`playerstatus.state == "play"`:

| Mode | While playing |
| --- | --- |
| `normal` | Timers transition normally |
| `on_while_playing` | No dimming and no standby; elapsed time keeps running |
| `dim_while_playing` | Dimming allowed, standby suppressed |

Starting playback in `dimmed` or `standby` wakes the panel for both
non-normal modes without resetting the deadlines. On pause or stop the state
is derived from the elapsed time.

Interactions inside one second after `set_power` are discarded, so the touch
that operates the switch does not wake the panel again immediately.

## Interaction sources

- RFID: subscriber on `inproc://PublisherToProxy`; every `*.card_id` topic
  counts as an interaction.
- Player status: the same subscriber forwards `playerstatus` to the state
  machine; it does **not** count as an interaction.
- Touch: the first `BTN_TOUCH` press or the `ABS_MT_TRACKING_ID` transition
  from -1 to a valid id. Device auto-detection accepts `EV_ABS` with `ABS_X`
  or `ABS_MT_POSITION_X`; `touch_device` restricts the match.
- Buttons: every configured `button_devices` entry uses `EvDevKeyListener`;
  all key codes of that device reset the timer.
- Web App: `display.activity`, sent by the request wrapper for interactive
  commands and directly by the standby overlay.

The monitor throttles resets to one per second. A `PermissionError` while
opening an input device adds `no_input_access` and leaves the other sources
usable.

## X11 software fallback

Without sysfs and without DDC/CI the plugin uses X11:

- Brightness is an X gamma multiplier (`xrandr --output <out> --brightness`).
  It dims the image, not the backlight; the status reports
  `brightness_source: "x11"` and the Web App shows a hint.
- Standby uses `xset dpms force off`, wake uses `xset dpms force on`
  followed by `xset -dpms`.
- `DISPLAY` is taken from the environment or defaults to `:0`. `XAUTHORITY`
  is taken from the environment or from the running `Xorg` command line;
  the newest `/tmp/serverauth.*` file is the last fallback. The daemon
  service does not inherit these variables, so the driver sets them for its
  subprocesses.
- Gamma survives DPMS off/on but is reset by an X restart. The driver
  re-resolves the authority file before a write when it disappeared.
- `@plugin.atexit` forces the panel on, so a stopped daemon does not leave a
  black screen behind.

**Precondition:** X must not blank on its own. The kiosk autostart keeps
`xset s off`, `xset s noblank` and `xset -dpms`; the plugin only drives DPMS
for its own standby and restores `-dpms` after a wake.

## Permissions

| Access | Requirement |
| --- | --- |
| `/sys/class/backlight/*/brightness` | Group `video` and a writable `brightness` file; `sudo -n tee` is a one-shot fallback |
| `/dev/i2c-*` for `ddcutil` | Group `i2c`, module `i2c-dev` |
| `/dev/input/event*` | Group `input` |
| X11 | No extra group; the daemon user must own or read the X authority file |

The installer prepares the groups, the udev rule and `ddcutil`. The plugin
reports the missing capability as `no_backlight_device`, `no_ddc_access`,
`no_x_access` or `no_input_access` and keeps the remaining sources usable.

## Web App integration

- The settings section is `src/webapp/src/components/Settings/display/` and
  is registered as `id="display"` after the timers section.
- Commands are added to `src/webapp/src/commands/index.js`; the live status
  topic `display.status` is subscribed in `src/webapp/src/config.js`.
- `src/webapp/src/utils/request.js` sends a throttled `display.activity`
  after successful interactive commands. `PASSIVE_COMMANDS` and
  `INTERACTIVE_COMMANDS` in `src/webapp/src/sockets/activity-commands.js`
  classify every command; the completeness test fails when a command is
  added without a decision. Calls in the `display` package never trigger the
  ping.
- `src/webapp/src/components/display/WakeOverlay.jsx` covers the UI in
  `standby`, swallows the first tap and sends one activity ping. It stays
  until the status leaves `standby`.

## Tests

- Python: `test/display/test_driver.py`, `test_state_machine.py`,
  `test_activity.py`, `test_rpc.py`.
- Web App: `display.test.jsx`, `wake-overlay.test.jsx`,
  `activity-commands.test.js`, `utils/request.test.js`.
- Manual checks on hardware are described in the acceptance step of the
  feature work.
