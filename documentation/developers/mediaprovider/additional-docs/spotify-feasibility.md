# Spotify Integration — Feasibility within the MediaProvider Architecture

## Question

Can a Spotify plugin be created within the MediaProvider architecture, where MPD is
always the audio playback backend?

PR #2164 replaced the player layer (`BackendPlayer` ABC) to enable Spotify and other
non-MPD backends. The MediaProvider approach keeps MPD as the universal audio sink.
Does this architecture support Spotify integration?

**Short answer:** Yes, but with a different approach than PR #2164. Spotify cannot be
played *through* MPD directly (MPD has no Spotify protocol support), but there are
viable options that work within the "MPD as audio sink" constraint.

---

## Why PR #2164's Approach Works for Spotify

PR #2164's `BackendPlayer` ABC abstracts the **playback engine**, not the content source.
A Spotify backend would implement `BackendPlayer` directly:

```python
class SpotifyBackend(BackendPlayer):
    def play_folder(self, uri, recursive):
        # librespot / spotifyd starts playing directly
        spotify_client.start_playback(uri)
    
    def pause(self):
        spotify_client.pause()
    
    def status(self):
        return spotify_client.get_status()
```

This works because each backend *is* the player. MPD is just one of several peers.
Spotify doesn't need to go through MPD — it talks to the Spotify API/librespot directly.

## Why MediaProvider's Approach is Different

The MediaProvider architecture enforces:

```
Content Source (SpotifyProvider) → MPD (Audio Backend) → Audio Output
```

MPD must be able to play whatever the provider gives it. MPD can play:
- Local files (via filesystem paths)
- HTTP streams (via URLs)
- Podcasts / Internet radio (via playlist files)
- **Cannot** play: Spotify streams (encrypted, proprietary protocol)

## Viable Options within the MediaProvider Architecture

### Option A: librespot → FIFO Pipe → MPD (Fragile, Not Recommended)

librespot can output raw PCM audio to STDOUT or a named pipe:

```
Spotify API → librespot → /tmp/spotify_fifo (PCM) → MPD plays fifo:///tmp/spotify_fifo
```

**Problems:**
- MPD would see one endless "stream" — no track boundaries, no metadata per track
- Seeking, next/prev would need to go through librespot, not MPD
- Volume control conflicts (Spotify has its own volume normalization)
- Fragile: FIFO breaks on restart, needs monitoring
- No cover art, no track metadata in MPD status

**Verdict:** 🟡 Theoretically possible, practically unusable for a good UX.

### Option B: Replace MPD with Mopidy (Recommended if Spotify is Required)

**Mopidy** is an MPD-compatible music server with extension support. It speaks the
MPD protocol (same wire protocol as MPD), so `python-mpd2` works unchanged.
Mopidy has a `mopidy-spotify` extension that provides full Spotify integration.

```
Content Source (SpotifyProvider) → Mopidy (MPD-compatible, with Spotify extension) → Audio Output
                                     ↑
Content Source (MpdMediaProvider) ────┘ (also works, Mopidy plays local files too)
```

**What changes:**
- `MpdMediaProvider` uses `python-mpd2` → unchanged (Mopidy speaks MPD protocol)
- `PlayerMPD` connection to `localhost:6600` → connects to Mopidy
- Spotify tracks appear in Mopidy's database like any other tracks
- `player.ctrl.next()`, `player.ctrl.status()` all work identically

**What doesn't change:**
- MediaProvider ABC — completely unchanged
- MediaProviderManager — completely unchanged
- Card routing (`decode_card_command`) — unchanged
- `provider:`-based `cards.yaml` — unchanged
- RPC interface — unchanged

**SpotifyProvider implementation:**

```python
class SpotifyMediaProvider(MediaProvider):
    """
    MediaProvider that exposes Spotify content via Mopidy's Spotify extension.
    
    Mopidy handles all Spotify protocol details (authentication, streaming,
    DRM, track metadata). This provider only needs to map Spotify URIs
    to Mopidy's browse/search interface.
    """
    
    def __init__(self, mpd_backend: MediaProvider):
        super().__init__()
        self._mpd = mpd_backend  # Actually Mopidy, but speaks MPD protocol
    
    def initialize(self):
        """Mopidy Spotify extension is configured via mopidy.conf. Nothing to do."""
        pass
    
    @plugs.tag
    def play_folder(self, folder: str, recursive: bool = False):
        """
        'folder' is a Spotify URI: spotify:album:xxx, spotify:playlist:xxx, etc.
        Mopidy understands these URIs natively and adds all tracks to the queue.
        """
        # Mopidy accepts spotify: URIs directly in add/addid!
        tracks = self._mpd.playlistinfo_for_uri(folder)  # Mopidy extension
        self._mpd.stop()
        self._mpd.clear_playlist()
        for track in tracks:
            self._mpd.add_to_playlist(track['uri'])
        self._mpd.play()
    
    @plugs.tag
    def play_single(self, song_url: str):
        """song_url is a spotify:track:xxx URI."""
        # Mopidy understands spotify:track: URIs natively
        self._mpd.play_single(song_url)
    
    @plugs.tag
    def list_albums(self) -> list:
        """Browse Spotify library via Mopidy."""
        return self._mpd.list_spotify_albums()
    
    @plugs.tag
    def search(self, query: str) -> list:
        """Search Spotify via Mopidy."""
        return self._mpd.search('spotify', query)
    
    # ... all other methods delegate to self._mpd ...
```

**Trade-offs:**
| Aspect | MPD | Mopidy |
|---|---|---|
| **Local files** | ✅ Native | ✅ Native (via file backend) |
| **Spotify** | ❌ Not possible | ✅ Via mopidy-spotify extension |
| **Jellyfin** | ✅ HTTP streams | ⚠️ Via mopidy-jellyfin (less mature) |
| **SMB** | ✅ GVFS mount → local files | ✅ Same as MPD |
| **Resource usage** | Very low | Higher (Python, extensions) |
| **Stability** | Very stable, battle-tested | Less tested on RPi |
| **Configuration** | mpd.conf | mopidy.conf + extensions config |
| **MPD protocol** | Native | Compatible (99% of commands work) |

**Verdict:** 🟢 Best option if Spotify is a hard requirement. Keeps the MediaProvider
architecture intact. Mopidy is an MPD protocol-compatible drop-in replacement.

### Option C: Spotify as External Player + Control Integration (Hybrid)

Don't integrate Spotify into the MediaProvider system at all. Use **raspotify**
or **spotifyd** as a separate audio player, but have the Jukebox control it
via external commands:

```
┌─────────────────────────────────────┐
│ Jukebox Core                        │
│                                     │
│ MediaProviderManager                │
│   ├── mpd: MpdMediaProvider ──→ MPD │
│   ├── jellyfin: JellyfinProvider    │
│   └── smb: SmbMediaProvider         │
│                                     │
│ (no SpotifyMediaProvider)           │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│ External (separate process)         │
│                                     │
│ spotifyd / raspotify                │
│   • Controlled via Spotify Connect  │
│   • Audio via ALSA/PulseAudio       │
│   • Volume via PulseAudio (shared)  │
│   • Track info via D-Bus / MPRIS    │
└─────────────────────────────────────┘
```

**How cards would work:**
```yaml
# Spotify card: triggers a shell command via alias (NOT a MediaProvider)
rfid_card_spotify_playlist:
  alias: host.exec
  args: ["spotify play playlist:xyz"]
```

```python
# Or via a dedicated RPC command in misc.py:
@plugs.register
def spotify_play(uri: str):
    """Send play command to spotifyd via D-Bus."""
    subprocess.run(['playerctl', '--player=spotifyd', 'play'])
```

**Verdict:** 🟡 Works, but no integration with the MediaProvider system.
Cards use `alias: host.exec` or custom RPC commands. No second-swipe
(unless explicitly implemented outside the MediaProvider). No unified
library browsing. Feels like a bolt-on, not an integration.

### Option D: librespot as a dedicated backend within PlayerMPD (Hybrid)

Keep MPD for local files but add Spotify as a *second backend* inside
`PlayerMPD`, switched by the URI prefix:

```python
class PlayerMPD:
    def __init__(self):
        self.mpd_client = MPDClient()
        self.spotify_client = librespot.SpotifyClient()  # NEW
        self._active_backend = 'mpd'
    
    def play_uri(self, uri: str):
        if uri.startswith('spotify:'):
            # Switch to Spotify backend, stop MPD
            self._active_backend = 'spotify'
            self.mpd_client.stop()
            self.spotify_client.play(uri)
        else:
            # Switch to MPD backend, stop Spotify if playing
            self._active_backend = 'mpd'
            self.spotify_client.pause()
            self.mpd_client.clear()
            self.mpd_client.add(uri)
            self.mpd_client.play()
```

**This is essentially PR #2164's approach** — multiple backends within the player.
It breaks the "MPD is always the audio backend" constraint but achieves the goal
with minimal architectural change.

**Verdict:** 🟡 Works (it's what PR #2164 does), but violates the MediaProvider
principle. Makes `PlayerMPD` a multi-backend arbiter instead of a clean MPD wrapper.

## Comparison Summary

| Approach | Spotify plays? | MediaProvider compatible? | Complexity | Audio path |
|---|---|---|---|---|
| PR #2164 (BackendPlayer) | ✅ | ❌ (replaces MediaProvider) | Medium | Backend-specific |
| **A: FIFO pipe to MPD** | ⚠️ (fragile) | ✅ | High | librespot→pipe→MPD→ALSA |
| **B: Mopidy instead of MPD** | ✅ | ✅ (drop-in) | Medium | Mopidy→ALSA |
| **C: External spotifyd** | ✅ | ❌ (bypasses system) | Low | spotifyd→ALSA |
| **D: Hybrid inside PlayerMPD** | ✅ | ⚠️ (violates "MPD is sink") | High | MPD+librespot→ALSA |

## Recommendation

### If Spotify is a priority:

**Option B (Mopidy)** is the cleanest path within the MediaProvider architecture.
It preserves all the architectural benefits:
- Single `MediaProvider` ABC for all content sources
- Unified `cards.yaml` format (`provider: spotify`, `value: "spotify:album:xxx"`)
- Second-swipe works identically (global `_last_played_folder` in Manager)
- `play_card_callbacks` fire from the Manager
- Card routing via `_resolve_provider()` works unchanged
- RPC interface is identical

The cost is replacing MPD with Mopidy on the system. This is a deployment change,
not an architectural change — the Python code doesn't change.

### If Spotify is "nice to have":

**Option C (External spotifyd)** via `alias: host.exec` cards. Simple, no
architectural impact, but no deep integration.

### If the "MPD is always the sink" constraint must be strictly enforced:

Then only Option A (FIFO pipe) works within the constraint, but it's not
practically viable for a good user experience. In this case, either:
- Accept Spotify is out of scope for the MediaProvider system
- Relax the "MPD is always sink" constraint for specific backends that *are*
  the player (Spotify, potentially YouTube, etc.)

## Implementation Strategy: MPD First, Mopidy Later

**Recommended: Implement Milestones 0-7 entirely with MPD. Defer the Mopidy/Spotify
switch to optional Milestones 8 (Mopidy Migration) and 9 (Spotify Provider).**

### Why this works

`python-mpd2` communicates via the MPD wire protocol on `localhost:6600`. **All**
MPD commands used across the MediaProvider plan are standard protocol commands
that Mopidy implements identically:

| Command | Used in | Mopidy Support |
|---|---|---|
| `clear()` | M2 (playlist clearing), M4/M6 (external providers) | ✅ Full |
| `addid(uri)` | M2 (playlist building), M4/M6 | ✅ Full |
| `play()`, `stop()`, `pause()`, `next()`, `previous()` | M2, all providers | ✅ Full |
| `status()` | M2 (MPD status poll) | ✅ Full |
| `playlistinfo()` | M2 (queue display) | ✅ Full |
| `lsinfo(path)` | M2 (folder browsing) | ✅ Full |
| `find()`, `list()` | M2 (metadata queries) | ✅ Full |
| `update(path)` | M2 (library rescan) | ✅ Full |

**Zero Python code changes** are needed when switching. The only difference is
which daemon answers on port 6600 — `mpd` or `mopidy`.

### Concrete impact: Nothing changes in Milestones 0-7

| Milestone | MPD-specific? | Mopidy-compatible? |
|---|---|---|
| M0 (Prerequisites) | No — Core utilities | ✅ Identical |
| M1 (MediaProvider Interface) | No — ABC, Manager | ✅ Identical |
| M2 (MPD-Adapter) | Yes — wraps `python-mpd2` | ✅ Identical (same protocol) |
| M2b (CoverartCache) | No — mutagen, file cache | ✅ Identical |
| M2c (Async MPD Listener) | Yes — `mpd.asyncio.MPDClient` | ✅ Identical (same protocol) |
| M3 (Jellyfin API Client) | No — REST client | ✅ Identical |
| M4 (Jellyfin Provider) | No — delegates to MPD-backend | ✅ Identical |
| M5 (Card Routing) | No — `_resolve_provider()` | ✅ Identical |
| M6 (SMB Provider) | No — gio mount, delegates to MPD | ✅ Identical |
| M7 (Plugin Installer) | No — generic installer | ✅ Identical |

**The Mopidy switch is purely a deployment change** — install `mopidy` + `mopidy-spotify`
instead of `mpd`, update `mopidy.conf` with the same `music_directory`, and port 6600
remains the same.

### Optional Milestone 8 & 9 (deferred, future)

| # | Milestone | Description |
|---|---|---|
| 8 | [Optional] Mopidy Migration | Installer option: replace MPD with Mopidy. Update config. Zero Python code changes. |
| 9 | [Optional] Spotify Provider | `SpotifyMediaProvider` implementing `MediaProvider`. Cards: `provider: spotify`, `value: "spotify:album:xxx"`. Uses Mopidy's Spotify extension. |

These milestones are **independent of Milestones 0-7** and can be implemented
at any time — before, during, or after the core MediaProvider milestones.

### What about systems that need to support *both* MPD and Mopidy?

**Not needed.** Mopidy is a **replacement** for MPD, not an addition. You run
either `mpd` or `mopidy`, never both on port 6600. Mopidy handles local files
identically via its file backend. The user's music library doesn't change.

If someone must keep both (e.g., MPD for local files + Spotify), the external
spotifyd approach (Option C) is simpler — run spotifyd alongside MPD, control
via `alias: host.exec` cards.

### Summary

```
Milestones 0-7 (Core MediaProvider)
  │
  │  Uses python-mpd2 ←→ MPD on :6600
  │  (all standard MPD protocol commands)
  │
  ▼
Milestone 8 (Optional: Mopidy Migration)
  │
  │  Replace MPD with Mopidy on :6600
  │  No Python code changes needed
  │
  ▼
Milestone 9 (Optional: Spotify Provider)
  │
  │  SpotifyMediaProvider implements MediaProvider ABC
  │  Delegates to Mopidy's Spotify extension
  │  Cards: provider: spotify, value: "spotify:album:xxx"
  │  Full second-swipe, callbacks, library browsing
  │
  ▼
  ✓ Spotify integration complete
```

---

*Analysis date: 2026-07-18*