# Navigation on the Start View

The Web App shows a bottom navigation bar on the start view by default. On a
kiosk the bar starts hidden so the player stays clean. The library, cards and
settings views keep the navigation so the box remains operable.

## Settings

Open **Settings → General** and use the two switches:

- **Show navigation (local)** applies to the current device. The value is stored
  in the browser, so every desktop and the kiosk keep their own state. In the
  kiosk it starts disabled; on every other device it starts enabled.
- **Show navigation (global)** is stored in the box configuration and overrides
  the local setting for every device. It is disabled by default. While it is
  enabled, the local switch is disabled.

## Showing the Navigation in the Kiosk

Tap the cover on the start view seven times within three seconds. The
navigation appears and the local setting is stored as enabled, so it stays
visible after a reload. Disable the local setting again in
**Settings → General** to hide it.

## Configuration File

The two defaults live in `jukebox.yaml` under `webapp`:

- `navigation_visible_global` (default `false`)
- `navigation_visible_kiosk_seed` (default `false`)

The kiosk loads the Web App from `http://localhost` and seeds its local value
from `navigation_visible_kiosk_seed` on the first load. Every other origin
starts with the navigation visible.
