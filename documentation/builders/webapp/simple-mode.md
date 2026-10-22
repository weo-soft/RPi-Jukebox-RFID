# Simple Mode and Volume

The start view has a reduced layout for the kiosk and a full layout for
desktops. The **Simple mode** switch is in **Settings → General** and belongs to
the current device.

## Simple Mode

The kiosk starts with simple mode enabled; every other origin starts with the
full layout. In simple mode:

- shuffle and repeat are hidden,
- the seek bar and the time labels are hidden,
- the control labels below the buttons are hidden.

Previous, play/pause, next and the volume buttons remain available. The full
layout shows shuffle, repeat, the seek bar and labels under the controls.

The choice is stored in `localStorage` under `simpleMode`, so it survives a
reload and a restart of the kiosk browser.

## Volume

The volume row has large `−` and `+` buttons next to the slider. Each press
changes the volume by five percent and stops at zero and at the configured
maximum volume. A large overlay shows the new level; muting and unmuting show
their own feedback. The slider remains available for fine control.

The maximum volume is configured under **Settings → Audio**.
