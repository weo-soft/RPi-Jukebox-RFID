# Boot time

This page explains what the start-up of a Phoniebox consists of, how to measure
it correctly and which parts the installation already shortens.

## What the start-up consists of

| Phase | Handled by | Visible in `systemd-analyze` |
| --- | --- | --- |
| Bootloader and firmware | Raspberry Pi EEPROM, `start4.elf` | no |
| Kernel | Linux | as `kernel` |
| System units up to `multi-user.target` | systemd | as `userspace` |
| User session, MPD, Jukebox core | systemd user manager | only with `--user` |
| Kiosk mode: X server and Chromium | login shell | no |

The Jingle that signals readiness is played by the core once all plugins are
loaded. The Web App appears after nginx (already running) and Chromium have
started the frontend.

## Why `systemd-analyze` understates the boot time

`systemd-analyze` starts its clock with the first kernel message. Everything
before that — ROM boot, EEPROM bootloader, firmware, loading the kernel image
from the SD card — is missing from the output. On a Raspberry Pi 4 this phase
takes a few seconds and cannot be shortened by any configuration of the
Jukebox.

A second blind spot: the core and MPD are **user units**. They appear only in
`systemd-analyze --user`, never in the plain `systemd-analyze blame` output.

A third trap: the Raspberry Pi has no real-time clock. The clock is restored
from the last shutdown and corrected by NTP during the boot, so wall-clock
times of early processes (`ps -eo lstart`, log lines without monotonic
timestamps) can be off by minutes. Only `/proc/uptime` and monotonic journal
timestamps are reliable.

## Measuring

```bash
# Phases up to multi-user.target
systemd-analyze
systemd-analyze blame | head -25
systemd-analyze critical-chain

# The same for the user session (MPD, Jukebox core)
systemd-analyze --user blame | head -25
systemd-analyze --user critical-chain

# Time up to and inside the core
systemctl --user show -p ExecMainStartTimestampMonotonic jukebox-daemon.service
grep -E "Start-up time|Playing wave file" ~/RPi-Jukebox-RFID/shared/logs/app.log

# Timeline with monotonic timestamps
journalctl -b -o short-monotonic --no-pager | less
```

The firmware phase is measured with a stopwatch: note the time when the power
button is pressed, then compare it with the calculated kernel start.

```bash
echo "uptime:         $(awk '{print $1}' /proc/uptime) s"
echo "kernel start:   $(date -d "-$(awk '{printf "%d", $1}' /proc/uptime) sec" '+%H:%M:%S')"
```

The difference between the two values is the time the bootloader and firmware
needed. It is only meaningful when the system clock is synchronised, which
`timedatectl` reports as `System clock synchronized: yes`.

On Raspberry Pi OS the journal is kept in memory only, so older boots cannot be
inspected. Create `/var/log/journal` if a comparison across several boots is
needed.

## What the installation optimises

`installation/routines/optimize_boot_time.sh` runs during the installation and
performs the following changes:

* Kernel command line: no boot splash, no logo, no Plymouth, reduced log level,
  `noatime`/`nodiratime`
* `disable_splash=1` in `config.txt`, so the display stays dark until the Web
  App appears
* `keyboard-setup`, `triggerhappy`, `raspi-config` and the `apt-daily` timers
  are disabled
* cloud-init is disabled; it provisions cloud images and delays
  `sysinit.target` on a finished Jukebox
* `NetworkManager-wait-online.service` is disabled, and nginx is removed from
  the `network-online.target` ordering. Both serve the Web App, which binds a
  local port and does not need a configured network
* Bluetooth can be disabled through the installation options

On a Raspberry Pi 4 with a 16 GB SD card this reduced the system part from
22.3 s to 15.0 s (`multi-user.target` from 19.96 s to 12.47 s).

The MPD configuration in `resources/default-settings/mpd.default.conf` disables
the automatic database update (`auto_update "no"`). The core triggers the
update itself at start-up and whenever the library changes through the Web App.
Files that are copied into the music directory outside the Web App, for example
over Samba, need a refresh in the Web App before they appear.

Jingles play through ALSA. If the audio device does not accept the stream, the
playback is aborted after its own duration plus ten seconds and an error is
written to `shared/logs/errors.log` instead of blocking the caller.

## Kiosk mode

With kiosk mode enabled the chain is `.bashrc` → `startx` → openbox →
Chromium. On a Raspberry Pi 4 the X server needs about four seconds and the
frontend a few more. To measure the chain, add timestamps based on
`/proc/uptime` to the start of `~/.bashrc`, `~/.xinitrc` and
`/etc/xdg/openbox/autostart`.

## If the box is still slow

* **Check the firmware phase first.** If more than a few seconds pass before
  the kernel starts, no Jukebox setting is involved. Typical causes are the
  network install of the Pi bootloader (`NET_INSTALL_ENABLED`,
  `NET_INSTALL_AT_POWER_ON`), a `BOOT_ORDER` that contains network or USB boot,
  a slow SD card, or connected USB devices. `sudo rpi-eeprom-config` shows the
  current bootloader configuration.
* **Look at the system units.** `systemd-analyze blame` names the slow unit. A
  repeating `netplan generate` in the journal costs about 1.5 s per call and
  appears once per network device.
* **Look at the user units.** MPD and the core are only visible with
  `systemd-analyze --user`.
* **Look at the core itself.** The line `Start-up time` in
  `shared/logs/app.log` reports how long the core needed from its first log
  line to a running API.
