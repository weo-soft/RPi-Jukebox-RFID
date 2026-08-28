# Generic USB Reader

**place-capable**: typically no

This module covers all types of USB-based RFID input readers. If you
plan to connect multiple USB-based RFID readers to the Jukebox, make
sure to connect all of them before running the [RFID reader configuration tool](../coreapps.md#RFID-Reader).

> [!IMPORTANT]
> This reader has **no automatic defaults**: it always requires the
> interactive customization (the tool asks you to pick the USB input
> device from the list). Non-interactive invocations of the RFID
> configuration tool without a terminal cannot configure it and abort
> with a clear message — run the tool from an interactive terminal,
> for example by executing `run_register_rfid_reader.py` from
> `src/jukebox`.

The user running the Jukebox needs the required system permissions:

> [!NOTE]
> The user needs to be part of the group \'input\' for evdev to work. This should usually be the case. However, a user can be added with:
>
>``` bash
>sudo usermod -a -G input USER
>```
