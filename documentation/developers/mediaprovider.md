# MediaProvider Architecture

The MediaProvider layer abstracts media sources behind a single interface, so a
card, the WebUI, or any RPC client can address content (folders, files, albums)
without knowing which backend serves it. This document describes the **current,
implemented** state of this architecture.

> **Status:** MediaProvider interface + MPD adapter are implemented on
> `future3/feature/mediaprovider-plus-mpd-adapter`.

## Concepts

```
┌─────────────────────────────────────────────────────────────────────┐
│ MediaProviderManager (jukebox/mediaprovider/manager.py)             │
│   - Module singleton (get_manager())                                │
│   - Provider registration / resolution                              │
│   - Global second-swipe state (_last_played_folder)                 │
│   - Global second_swipe_action (injected from playermpd)            │
│   - Central play_card_callbacks (injected from playermpd)           │
└─────────────────────────────────────────────────────────────────────┘
        │                     │                       │
        ▼                     ▼                       ▼
┌──────────────┐   ┌──────────────────┐   ┌───────────────────────┐
│ MPD          │   │ future: Jellyfin │   │ future: SMB, ...      │
│ (always      │   │ (external        │   │ (external providers)  │
│  active,     │   │  providers)      │   │                       │
│  default)    │   │                  │   │                       │
│ MpdMediaPro- │   │                  │   │                       │
│ vider wraps  │   │                  │   │                       │
│ PlayerMPD    │   │                  │   │                       │
└──────────────┘   └──────────────────┘   └───────────────────────┘
```

### `jukebox.mediaprovider` (Core package)

Location: `src/jukebox/jukebox/mediaprovider/`

| File | Purpose |
|---|---|
| `__init__.py` | Abstract base class `MediaProvider` |
| `manager.py` | `MediaProviderManager` singleton + `get_manager()` |

The package is a **core package** (not a plugin component). It is loaded
explicitly in `daemon.py` (`import jukebox.mediaprovider`) to guarantee
initialization before plugins start.

### `MediaProvider` (abstract base class)

Defines the interface every media provider implements. Key points:

- `play_card(folder, recursive=False)` implements the **second-swipe logic**
  in the base class. Concrete providers **must not** override it.
- The `folder` argument is **provider-opaque**: each provider interprets it in
  its own addressing scheme (MPD: relative library path; Jellyfin: item ID;
  SMB: `share:/path`).
- All RPC-callable methods of concrete providers must be decorated with
  `@plugs.tag` (`plugs.dereference()` requires `plugs_callable = True`).
- Additional abstract methods for playlist management used by external
  providers: `clear_playlist()` and `add_to_playlist(song_url)`.

### `MediaProviderManager`

Module-level singleton accessed via `get_manager()`:

```python
from jukebox.mediaprovider import get_manager

mgr = get_manager()
mgr.register_provider('mpd', mpd_provider)   # register
mgr.set_default('mpd')                       # default (RPC fallback)
mgr.resolve('mpd')                           # resolve by name
mgr.resolve()                                # resolve default provider
mgr.list_providers()                         # ['mpd', ...]
```

The manager centralizes:

- **`_last_played_folder`** - global second-swipe state, shared by all providers
  and by `PlayerMPD.play_card()` / `PlayerMPD.play_folder()`. Persisted via the
  existing `music_player_status.json` through an injected persist callback.
- **`_second_swipe_action`** - resolved once from `playermpd.second_swipe_action`
  and injected by `playermpd/__init__.py` during `@plugs.initialize`.
- **`play_card_callbacks`** - created in `playermpd/__init__.py` (with MPD lock
  context) and injected via `set_play_card_callbacks()`. All providers fire these
  callbacks through the manager. Backward compatibility:
  `from components.playermpd import play_card_callbacks` still works.

### Second-swipe behaviour (shared)

```
Card swipe -> decode_card_command() -> {provider}.provider.play_card(folder)
  -> MediaProvider.play_card() (inherited by all providers)
    -> Manager: last_played_folder == folder ? second swipe : first swipe
    -> Manager: set + persist last_played_folder
    -> Manager: fire play_card_callbacks (firstSwipe / secondSwipe)
    -> second swipe: run second_swipe_action() (if configured)
    -> first swipe: self.play_folder(folder, recursive)
```

Because the *folder value* (not the provider identity) is compared, the same
folder swiped via two different providers is still detected as a second swipe.
This is intentional: the second swipe is about the content, not the provider.

## `PlayCardState` extraction

`PlayCardState` was moved from
`components/playermpd/playcontentcallback.py` into the neutral core module
`jukebox/callingback.py`:

```python
class PlayCardState(Enum):
    """States for play_card callbacks in PlayContentCallbacks"""
    firstSwipe = 0
    secondSwipe = 1
```

`components/playermpd/playcontentcallback.py` re-exports it for backward
compatibility:

```python
from jukebox.callingback import CallbackHandler, PlayCardState  # noqa: F401
```

## MPD adapter (`player.provider.*`)

`MpdMediaProvider` (`components/playermpd/mpd_provider.py`) implements the
`MediaProvider` interface by delegating to the existing `PlayerMPD` instance.

- It is registered during `playermpd/__init__.py` `@plugs.initialize`:
  `plugs.register(mpd_provider, package='player', name='provider')`.
- It shares the existing `PlayerMPD` instance (no double initialization).
- It **does not override** `play_card()` - the base class implementation is used.
- `play_folder()` auto-detects whether the value resolves to a file or a
  directory; files are routed to `PlayerMPD.play_single()`.

### RPC namespace

| RPC | Description |
|---|---|
| `player.ctrl.play_folder("Album")` | Direct `PlayerMPD` access (unchanged, backward compatible) |
| `player.provider.play_folder("Album")` | MediaProvider interface access (uniform provider API) |
| `player.provider.play_card("Album")` | Inherited base-class second-swipe logic |

`player.ctrl.*` remains fully backward compatible.

### `PlayerMPD` refactor highlights

- `play_card()` / `play_folder()` read/write `_last_played_folder` via
  `get_manager()` instead of touching the raw dict, so alias-based and
  provider-based cards share the same second-swipe state.
- `replay()` / `replay_if_stopped()` read the last played folder via the manager.
- `get_current_song()` no longer has the unused `param` argument.
- `play_card_callbacks`, the persist callback, and `second_swipe_action` are
  injected into the manager during `@plugs.initialize`.
- Persisted `_last_played_folder` is restored into the manager at startup so
  both paths start from the same state.

## Implementing a new provider (summary)

1. Create a plugin package under `src/jukebox/components/<name>/`.
2. Subclass `jukebox.mediaprovider.MediaProvider` and implement all abstract
   methods. Decorate every RPC-callable method with `@plugs.tag`.
3. Do **not** override `play_card()` - inherit the base implementation.
4. In the plugin's `@plugs.initialize`: resolve the MPD backend via
   `get_manager().get_provider('mpd')`, create your provider, register it with
   `get_manager().register_provider('<name>', provider)`, and expose RPC via
   `plugs.register(provider, package='<name>', name='provider')`.
5. Add `<name>` to `modules.others` in `jukebox.yaml` to activate.

## Tests

- `test/callingback/test_playcardstate.py`
- `test/mediaprovider/test_manager.py`
- `test/mediaprovider/test_base.py`

Run with:

```bash
./run_pytest.sh
```
