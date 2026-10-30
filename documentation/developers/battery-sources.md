# Battery Sources

The `battery_monitor` package in `src/jukebox/components/` provides one battery
contract for the core, the Web App and the RPC clients. The package contains
the base class, an adapter per measurement source and nothing else. The
configured adapter is loaded as the module `battmon` and registers its instance
as the plugin `batt_mon`, so the RPC path is `battmon.batt_mon.get_batt_status`.

## Adapter Contract

An adapter is a module below `components/battery_monitor/` that inherits from
`BattmonBase`, implements `init_batt_mon_hw(num, denom)` and overrides either
`read()` or `get_batt_voltage()`:

```python
class battmon_example(BatteryMonitorBase.BattmonBase):
    source_name = 'example'

    def init_batt_mon_hw(self, num, denom):
        self._device = open_device(self._cfg.setndefault('battmon', 'example', 'path', value=None))

    def read(self):
        return BatteryReading(soc=42, state='idle', voltage_v=4.0)
```

| Member | Purpose |
| --- | --- |
| `source_name` | Short identifier, published as `source`. Defaults to `unknown`. |
| `soc_from_voltage` | Whether the base class may derive `soc` from the voltage curve. Defaults to `True`. |
| `init_batt_mon_hw(num, denom)` | Prepares the hardware. `num` and `denom` are the configured scaling factors. Raises on a configuration error. |
| `read()` | Returns one `BatteryReading`. Raises `BatterySourceError` when no reading can be obtained. |
| `get_batt_voltage()` | Legacy entry point: returns the battery voltage in millivolt. The default `read()` uses it. |

`self._cfg` is the jukebox configuration handler, so an adapter reads its own
settings from the `battmon` block. `init_batt_mon_hw` runs before the poll
timer starts; raising there keeps a misconfigured adapter from polling.

`BatteryReading` carries `soc`, `state`, `voltage_v`, `current_ma`, `power_w`,
`remaining_s` and `timestamp`. Every field is optional; `None` means unknown
and is left out of the published object. Adapters that provide only a voltage
override `get_batt_voltage()` and leave `read()` untouched.

## Reading And Errors

The base class calls `read()` from the poll timer and catches every exception.
A failing source publishes

```json
{"available": false, "state": "unavailable", "charging": false,
 "source": "example", "timestamp": "..."}
```

and logs the change of the error message once on `warning` level. The timer
continues, so the adapter recovers by itself when the next reading succeeds.
No threshold action runs while the source is unavailable.

`BatterySourceError` is the required exception for the bundled adapters; any
other exception is handled the same way.

## Derived Values

The adapter is authoritative: a value it reports is published unchanged. The
base class fills the gaps:

* the voltage is smoothed with two first order filters and published in
  millivolt as `voltage` and in volt as `voltage_v`
* `soc` is derived from the voltage curve only when the reading has none and
  `soc_from_voltage` is `True`
* `state` is derived from the voltage history only when the reading has none;
  a value outside the known states becomes `unknown`
* `charging` is `true` exactly when the state is `charging`

Adapters that measure a pack instead of a single cell set
`soc_from_voltage = False` and report `soc` themselves, because the built-in
curve describes a single cell.

## Registration

Adapters register themselves during the plugin finalization, like the existing
sources:

```python
@plugs.finalize
def finalize():
    global batt_mon
    cfg = jukebox.cfghandler.get_handler('jukebox')
    batt_mon = battmon_example(cfg)
    plugs.register(batt_mon, name='batt_mon')


@plugs.atexit
def atexit(**ignored_kwargs):
    global batt_mon
    batt_mon.status_thread.close()
```

The module is selected in the main configuration:

```yaml
modules:
  named:
    battmon: battery_monitor.batt_mon_example
```

Only one adapter is active at a time, because every adapter registers the same
plugin name. Without a `battmon` entry no battery monitor is loaded.

## Tests

Adapters are tested with a fake configuration, a timer replacement without a
thread and a mocked publisher; see `test/battery_monitor/`. The plugin
decorators register finalizers at import time, so a test that imports an
adapter directly sets `plugs.ALLOW_DIRECT_IMPORTS = True` around the import.
