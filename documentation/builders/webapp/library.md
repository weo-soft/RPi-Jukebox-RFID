# Library Pagination

The library renders its album and other cover-bearing item lists in pages, so a
large collection does not load every cover at once. The default is 100 entries per page.

## Changing the Page Size for One Device

In the library, use the **Items per page** dropdown above the list. The choice
is stored in the browser and applies to the current device only. It survives a
reload and a restart of the kiosk browser.

## Changing the Default for All Devices

Open **Settings → General** and change **Items per page (default)**. The value
is stored in `jukebox.yaml` under `webapp` as `library_page_size` and applies to
every device that has not chosen its own page size. A device choice in the
library overrides this default.

## Configuration File

The default lives in `jukebox.yaml` under `webapp`:

- `library_page_size` (default `100`)

Supported values are 25, 50, 100, 200 and 500.
