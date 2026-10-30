# Battery Monitor

> [!CAUTION]
> Lithium and other batteries are dangerous and must be treated with care.
> Rechargeable Lithium Ion batteries are potentially hazardous and can
> present a serious **FIRE HAZARD** if damaged, defective, or improperly used.
> Do not use this circuit for a lithium-ion battery without the expertise and
> training in handling and using batteries of this type.
> Use appropriate test equipment and safety protocols during development.
> There is no warranty, this may not work as expected!

The battery monitor polls one configured source, publishes the normalized
status on the `batt_status` event and displays it in the Web App. An adapter
reads the measurement; the base class smooths the voltage, derives the
missing values, evaluates the thresholds and publishes the result.

## Battery Monitor based on a ADS1015

The script in [src/jukebox/components/battery_monitor/batt_mon_i2c_ads1015/\_\_init\_\_.py](../../../../src/jukebox/components/battery_monitor/batt_mon_i2c_ads1015/__init__.py) is intended to read out the voltage of a single Cell LiIon Battery using a [CY-ADS1015 Board](https://www.adafruit.com/product/1083):

```text
                                              3.3V
                                               +
                                               |
                                          .----o----.
                    ___                   |         |  SDA
          .--------|___|---o----o---------o AIN0    o------
          |         2MΩ    |    |         |         |  SCL
          |               .-.   |         | ADS1015 o------
         ---              | |  ---        |         |
 Battery  -          1.5MΩ| |  ---100nF   '----o----'
 2.9V-4.2V|               '-'   |              |
          |                |    |              |
         ===              ===  ===            ===
```

> [!WARNING]
>
> * the circuit is constantly draining the battery! (leak current up to: 2.1µA)
> * the time between sample needs to be a minimum 1sec with this high impedance voltage divider don't use the continuous conversion method!

## Battery Monitor based on an INA219

The script in [src/jukebox/components/battery_monitor/batt_mon_i2c_ina219/\_\_init\_\_.py](../../../../src/jukebox/components/battery_monitor/batt_mon_i2c_ina219/__init__.py) is intended to read out the voltage of a single cell or multiple LiIon Battery using a [INA219 Board](https://www.adafruit.com/product/904):

```text
                                                  3.3V
                                                   +
                                                   |
                                              .----o----.
                                              |         |  SDA
              .-------------------------------o AIN     o------
              |                               | INA219  |  SCL
              |                    .----------o AOUT    o------
             ---                   |          |         |
     Battery  -           Regulator + Raspi   '----o----'
     2.9V-4.2V|                    |               |
              |                    |               |
             ===                  ===             ===
```

The INA219 adapter needs the `ina219` Python package, which is not part of the
default installation.

## Battery Monitor based on a JSON status file

The adapter `batt_mon_json_file` reads a status file that another process
writes, for example a vendor monitor of an UPS module. The application does not
talk to the hardware; it only reads the file.

```yaml
modules:
  named:
    # Do not change the order!
    publishing: publishing
    ...
    battmon: battery_monitor.batt_mon_json_file

battmon:
  poll_interval_sec: 10
  json_file:
    path: /run/power/status.json
    stale_after_sec: 30
    fields: {}
    states: {}
```

The status file must contain a JSON object. The adapter reads it on every poll
and treats these situations as a read error:

* the file does not exist or cannot be read
* the file is older than `stale_after_sec`
* the content is not a JSON object
* the file provides no state of charge

### Canonical schema

The keys of the JSON object match the canonical field names by default:

```json
{
  "soc": 87,
  "state": "charging",
  "voltage_v": 12.005,
  "current_ma": 450.0,
  "power_w": 5.4,
  "remaining_s": 3600,
  "timestamp": "2026-10-29T20:00:00+00:00"
}
```

| Field | Meaning |
| --- | --- |
| `soc` | State of charge in percent, clamped to 0..100. Required. |
| `state` | `charging`, `discharging`, `idle` or `unknown`. |
| `voltage_v` | Battery voltage in volts. |
| `current_ma` | Current in milliampere; negative while discharging. |
| `power_w` | Power in watt. Derived from voltage and current when absent. |
| `remaining_s` | Remaining runtime in seconds, if the source knows it. |
| `timestamp` | ISO 8601 measurement time with time zone. |

### Field and state mapping

`fields` maps a canonical name to the key used by the source. Without an entry
the canonical name applies; `null` disables the field. A source key that is
missing from the file leaves the field unknown.

```yaml
battmon:
  json_file:
    fields:
      soc: percent
      voltage_v: battery_voltage_v
      power_w: null
    states:
      on-battery: discharging
      on-mains: charging
```

`states` maps source values onto the canonical states. Without an entry the
canonical values apply; any other value becomes `unknown`.

When the file carries no `power_w`, the adapter derives it from voltage and
current. The published power is always positive; the direction of the energy
flow is part of `state`.

The timestamp of the source is used when it is a valid ISO 8601 string with a
time zone. Otherwise the modification time of the file applies, so the
published timestamp always tells how old the measurement is.

## Thresholds and actions

The thresholds and the optional RPC actions are configured below `battmon`:

| Key | Default | Meaning |
| --- | --- | --- |
| `warning_voltage_mv` | `3300` | Warning below this voltage |
| `all_clear_voltage_mv` | `3400` | Warning cleared at or above this voltage |
| `shutdown_voltage_mv` | `3000` | Shutdown below this voltage |
| `warning_soc` | `null` | Warning at or below this charge level |
| `all_clear_soc` | `null` | Warning cleared at or above this charge level |
| `shutdown_soc` | `null` | Shutdown at or below this charge level |
| `warning_action` | `null` | RPC command when the warning starts |
| `all_clear_action` | `null` | RPC command when the warning ends |
| `poll_interval_sec` | `5` | Poll period in seconds, at least 1 |

A condition is evaluated only when it is configured and its measurement value
is present. A source that reports only the charge level therefore evaluates the
`soc` conditions and ignores the voltage conditions, and the other way round.

The actions are edge triggered: the warning action runs when the warning
starts, the all-clear action when it ends, and each runs at most once per
transition. The shutdown runs at most once per process. A read error triggers
no action at all.

The voltage thresholds default to the values of a single lithium cell. A
multi-cell pack needs thresholds that match its voltage range, or `soc`
thresholds with the voltage thresholds disabled:

```yaml
battmon:
  warning_voltage_mv: null
  all_clear_voltage_mv: null
  shutdown_voltage_mv: null
  warning_soc: 20
  all_clear_soc: 90
  shutdown_soc: 10
```

## Published status object

The monitor publishes the status on the `batt_status` event and returns the
same object through the `battmon.batt_mon.get_batt_status` RPC call:

```json
{
  "available": true,
  "soc": 87,
  "state": "charging",
  "charging": true,
  "voltage": 12005,
  "voltage_v": 12.005,
  "current_ma": 450.0,
  "power_w": 5.4,
  "source": "json_file",
  "timestamp": "2026-10-29T20:00:00+00:00"
}
```

`available`, `state`, `charging`, `source` and `timestamp` are always present.
`soc`, `voltage`, `voltage_v`, `current_ma`, `power_w` and `remaining_s` appear
only for known values. `voltage` is the smoothed voltage in millivolt.

Without a reading the object is `{"available": false, "state": "unavailable",
"charging": false, "source": "...", "timestamp": "..."}`.

## Web App display

The Web App shows a fixed battery indicator above the content on every page and
an extended row on the settings page. Both use the published status object and
appear only while the battery monitor is loaded.
