# Jellyfin

Phoniebox can use a Jellyfin media server as an additional music source.
The Jellyfin player backend streams audio through MPD — no extra playback
daemon is installed.

## Requirements

- A Jellyfin server (10.8.x or newer) with a music library
- An API key created in **Jellyfin Dashboard → API Keys**
  (recommended: create a dedicated Phoniebox user with access only to the
  music library and generate the API key from that user's dashboard)

## Installation

Run the installer and answer **yes** to the "Setup Jellyfin?" prompt.
You will be asked for:

1. **Server URL** — e.g. `http://jellyfin.local:8096`
2. **API key** — created in Dashboard → API Keys → Create

The installer stores these in `jukebox.yaml` and enables the plugin.

## Manual configuration

```yaml
# shared/settings/jukebox.yaml
players:
  jellyfin:
    enabled: true
    host: "http://jellyfin.local:8096"
    api_key: "your-api-key"
    catalog_cache_ttl: 300   # optional: seconds the album catalog is cached (default 300)
```

Restart the daemon: `sudo systemctl restart jukebox-daemon`

## Use

### Web App

Open the **Library** page. A **Jellyfin** source tab appears with
**Albums**. Browse, play, and create RFID cards as with the local library.

### RFID cards

```yaml
# shared/settings/cards.yaml
rfid_card_01:
  provider: "jellyfin"
  value: "service:jellyfin:album:<itemid>"

# or a single track:
rfid_card_02:
  provider: "jellyfin"
  value: "service:jellyfin:track:<itemid>"
```

## Troubleshooting

- **"No Jellyfin source tab"** — `players.jellyfin.enabled` is not `true`,
  wrong server URL, or the daemon needs a restart.
- **"Could not authenticate"** — check the API key and that the server is
  reachable from the Phoniebox.
- **Playback starts but no sound** — check MPD audio output (Jellyfin streams
  are played by MPD).
- **Jellyfin source shows an error while local library works** — the Jellyfin
  server is offline or unreachable; the local MPD library is unaffected.

## Known limitations

- Playlists are not yet supported (Albums only).
- The API key is sent as part of the MPD stream URL (required for playback),
  but is never exposed through any RPC method. Use a dedicated Phoniebox
  Jellyfin user with a scoped API key.
- Re-adding an item after a library re-scan on the Jellyfin server may change
  its item ID and invalidate previously stored card values.
