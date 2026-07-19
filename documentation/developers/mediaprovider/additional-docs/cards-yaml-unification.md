# cards.yaml Format Unification — Analysis

## Question

Can the `cards.yaml` format be **unified** so that **all** cards use the provider-based format
(`provider:` + `value:`) instead of extending the existing alias format with a new `provider:` field?

The existing plan (Milestone 5) proposes a **dual-format** approach:
```yaml
# Old format (kept for backward compatibility):
rfid_card_01:
  alias: play_card
  args: ["AlbumXYZ"]

# New format (added alongside old):
rfid_card_02:
  provider: "jellyfin"
  value: "folder_id_456"
```

This analysis explores whether the old format can be **migrated away** for media-playback cards,
and whether `decode_card_command()` can be simplified accordingly.

## Current State: What Cards Can Do

Cards in `cards.yaml` can trigger any RPC command via the alias system:

| Type | Example | Can use provider format? |
|---|---|---|
| Play folder (non-recursive) | `alias: play_card`, `args: ["Album"]` | ✅ Yes |
| Play folder (recursive) | `alias: play_folder`, `args: ["Album", true]` | ✅ Yes (with `recursive: true`) |
| Play single file | `alias: play_single`, `kwargs: {song_url: "song.mp3"}` | ⚠️ Partial (see below) |
| Skip track | `alias: player.ctrl.next` | ❌ No (command, not playback) |
| Shutdown | `alias: host.shutdown` | ❌ No (command, not playback) |
| GPIO actions | `alias: volume.set`, `args: [80]` | ❌ No (command, not playback) |
| Custom RPC | arbitrary `alias:` + `args:`/`kwargs:` | ❌ No (arbitrary commands) |

**Key distinction:** Cards fall into two categories:
1. **Playback cards** — trigger playback of a specific piece of content
2. **Command cards** — trigger arbitrary RPC commands (navigation, GPIO, system, etc.)

Only **playback cards** can be migrated to the provider format.
**Command cards** must stay with the alias format.

## Proposal: Unified Playback Format

### New Format

```yaml
# Playback cards (unified):
rfid_card_01:
  provider: "mpd"           # Provider name (mpd, jellyfin, smb, ...)
  value: "AlbumXYZ"         # Provider-opaque identifier
  recursive: false          # (optional, default: false)

rfid_card_02:
  provider: "jellyfin"
  value: "folder_id_456"

rfid_card_03:
  provider: "smb"
  value: "music:/Rock/AlbumXYZ"
  recursive: true

# Command cards (unchanged alias format):
rfid_card_shutdown:
  alias: host.shutdown

rfid_card_next:
  alias: player.ctrl.next
```

### Migration from Old Format

**Automatic detection in `decode_card_command()`:**

When a card entry has no `provider:` field but has `alias: play_card` or `alias: play_folder`,
treat it as `provider: mpd` with the first argument as `value`:

```python
# Migration logic (in decode_card_command, transparent to user):
if 'alias' in cfg_rpc_cmd and cfg_rpc_cmd['alias'] in ('play_card', 'play_folder'):
    # Legacy MPD playback card → Convert to provider format on the fly
    args = cfg_rpc_cmd.get('args', [])
    value = args[0] if args else ''
    recursive = len(args) > 1 and args[1] == True
    
    # Treat as: provider=mpd, value=value, recursive=recursive
    # (Route to player.provider.play_card(value, recursive=recursive))
```

This means:
- **User migration is automatic** — old entries continue to work without changes
- **No forced migration** — users can keep old format indefinitely
- **New entries** are written in unified format by WebUI/register_card()
- **Old format becomes deprecated** but supported through transparent conversion

### What `play_single` Cards

`play_single` cards (`alias: play_single`, `kwargs: {song_url: "path/to/song.mp3"}`) are tricky:

- `play_card()` in `MediaProvider` delegates to `play_folder()`
- `play_folder("song.mp3")` would treat a file path as a folder → incorrect
- MPD's `play_folder()` expects a directory path

**Solution A — Provider auto-detection:**
`MpdMediaProvider.play_card()` detects if the value is a file or directory and routes
to `play_single()` or `play_folder()` accordingly:

```python
# In MpdMediaProvider (override play_card for this detection, or add to play_folder):
def play_folder(self, folder: str, recursive: bool = False):
    full_path = os.path.join(get_music_library_path(), folder)
    if os.path.isfile(full_path):
        self.play_single(folder)  # It's a file, not a folder
    else:
        self._player.play_folder(folder, recursive)
```

> **Note:** This is a **minor violation** of the "no provider overrides `play_card()`" rule.
> `MpdMediaProvider` would still not override `play_card()`, but `play_folder()` would gain
> file/directory detection. This is acceptable because it's an MPD-specific optimization,
> not a structural change to the second-swipe logic.

**Solution B — `content_type` hint field:**
```yaml
rfid_card_song:
  provider: mpd
  value: "song.mp3"
  content_type: file       # explicit hint
```

**Solution C — Accept `play_single` cards as-is, don't migrate:**
Keep `play_single` in the alias format. It's a rare use case and not worth the complexity.

**Recommendation:** Solution A (auto-detection in `play_folder`) for simplicity.
Solution C as fallback if auto-detection proves unreliable with edge cases.

## Impact / Blast Radius

### Files to Change

| File | Change | Complexity |
|---|---|---|
| `components/rfid/cardutils.py` | `decode_card_command()` simplified: single playback path, legacy auto-detection | Medium |
| `components/rfid/cardutils.py` | `card_command_to_str()` updated for unified format display | Low |
| `components/rfid/cards/__init__.py` | `register_card()` writes `provider: mpd` format | Low |
| `components/playermpd/mpd_provider.py` | `play_folder()` gains file/directory auto-detection | Low |
| `src/webapp/src/` | Card assignment JS writes `provider: mpd` format | Low |
| `resources/default-settings/cards.example.yaml` | Update examples | Low |
| `test/card_routing/` | Update test cases | Low |
| `documentation/` | All `cards.yaml` examples | Low |

### What Does NOT Change

| Component | Status |
|---|---|
| `plugs.py` | No change |
| `daemon.py` | No change |
| `MediaProvider` ABC | No change |
| `MediaProviderManager` | No change |
| `rpc_command_alias.py` | No change (aliases remain for non-card use) |
| `PlayerMPD.play_card()` / `play_folder()` | No change (already using Manager state) |
| External providers (Jellyfin, SMB) | No change |

### User Impact

| Impact | Details |
|---|---|
| **Existing `cards.yaml`** | No changes needed — legacy aliases auto-detected |
| **New card registration** | WebUI writes unified format automatically |
| **Manual card editing** | Users can use either format; unified format is recommended |
| **Migration path** | Optional: run migration script to convert all entries to unified format |
| **Breaking changes** | **None** — old format works transparently |

## Simplification Analysis

### Current `decode_card_command()` (Dual-Format, ~60 lines)

```python
def decode_card_command(cfg_rpc_cmd, logger=log):
    if cfg_rpc_cmd is None:
        return None
    
    # NEW: MediaProvider routing
    if 'provider' in cfg_rpc_cmd:
        provider_name = cfg_rpc_cmd['provider']
        folder = cfg_rpc_cmd.get('value', '')
        # ... validation ...
        action = {
            'package': provider_name,
            'plugin': 'provider',
            'method': 'play_card',
            'args': (folder,),
            'kwargs': {},
        }
        # ... ignore_same_id_delay, ignore_card_removal_action ...
        return action
    
    # OLD: Alias-based routing (for backward compat)
    action = utils.decode_rpc_command(cfg_rpc_cmd, logger)
    # ... ignore_same_id_delay, ignore_card_removal_action ...
    return action
```

### Unified `decode_card_command()` (~35 lines)

```python
def decode_card_command(cfg_rpc_cmd, logger=log):
    if cfg_rpc_cmd is None:
        return None
    
    # Step 1: Resolve to provider format (with legacy auto-detection)
    provider_name, value, recursive, is_legacy = _resolve_provider(cfg_rpc_cmd, logger)
    
    if provider_name is None:
        # Not a playback card → fall through to alias system (commands, GPIO, etc.)
        action = utils.decode_rpc_command(cfg_rpc_cmd, logger)
        # ... ignore_same_id_delay, ignore_card_removal_action ...
        return action
    
    # Step 2: Route to provider
    try:
        from jukebox.mediaprovider import get_manager
        get_manager().resolve(provider_name)
    except (KeyError, RuntimeError) as e:
        logger.error(f"Provider '{provider_name}' not available: {e}")
        return None
    
    kwargs = {}
    if recursive:
        kwargs['recursive'] = True
    
    action = {
        'package': provider_name,
        'plugin': 'provider',
        'method': 'play_card',
        'args': (value,),
        'kwargs': kwargs,
    }
    
    if 'ignore_same_id_delay' in cfg_rpc_cmd:
        action['ignore_same_id_delay'] = cfg_rpc_cmd['ignore_same_id_delay']
    if 'ignore_card_removal_action' in cfg_rpc_cmd:
        action['ignore_card_removal_action'] = cfg_rpc_cmd['ignore_card_removal_action']
    
    return action


def _resolve_provider(cfg_rpc_cmd, logger):
    """
    Resolve provider, value, recursive from card config.
    
    Priority:
    1. Explicit provider: field → use directly
    2. Legacy alias: play_card / play_folder → auto-detect as provider=mpd
    3. Everything else → return None (not a playback card)
    """
    # Explicit provider field
    if 'provider' in cfg_rpc_cmd:
        return (
            cfg_rpc_cmd['provider'],
            cfg_rpc_cmd.get('value', ''),
            cfg_rpc_cmd.get('recursive', False),
            False  # not legacy
        )
    
    # Legacy MPD playback cards
    alias = cfg_rpc_cmd.get('alias')
    if alias in ('play_card', 'play_folder'):
        args = cfg_rpc_cmd.get('args', [])
        value = args[0] if args else ''
        recursive = len(args) > 1 and args[1] is True
        logger.debug(f"Auto-detected legacy MPD card: alias={alias}, value={value}")
        return ('mpd', value, recursive, True)  # legacy
    
    # Not a playback card (command, GPIO, etc.)
    return (None, '', False, False)
```

**Line reduction:** ~60 → ~35 (core logic) + ~15 (`_resolve_provider` helper)
**Complexity reduction:** One clear code path for all playback cards; alias path reserved for commands

### What This Enables

1. **Single code path for all playback cards** — no provider/alias branch in the main function
2. **Legacy auto-detection** — transparent, no user action needed
3. **New cards always use unified format** — WebUI, register_card() write `provider: mpd`
4. **Command cards unchanged** — shutdown, GPIO, next/prev still use alias format
5. **Natural deprecation path** — old format still works but new features only test unified path
6. **Easier RPC debugging** — all playback is `{provider}.provider.play_card(value)`, not a mix of `play_card`, `play_folder`, `play_single`, `play_uri`

## Comparison: Dual-Format vs. Unified

| Aspect | Dual-Format (current plan) | Unified (proposed) |
|---|---|---|
| **Card formats** | 2 formats (alias + provider) | 1 format for playback + alias for commands |
| **`decode_card_command()` logic** | Two explicit branches | One primary path + legacy helper |
| **Legacy support** | Old format kept indefinitely | Auto-detected, transparent |
| **New cards** | Can use either format | Always use unified format |
| **`play_single` cards** | Stay as alias | Auto-detect or stay as alias |
| **RPC path consistency** | Two paths to MPD playback | One path: `player.provider.play_card()` |
| **Second-swipe** | Shared via Manager (both paths) | Only one path → simpler state management |
| **`PlayerMPD.play_card()`** | Still used for alias path | Only used for legacy auto-detection |
| **Migration effort** | None (both formats coexist) | None (auto-detection) |
| **User confusion** | Two ways to do the same thing | One clear way for playback |

## Recommendation

**Adopt the unified playback format with legacy auto-detection.**

### Rationale

1. **Simplifies `decode_card_command()`** — ~25% line reduction, single primary code path
2. **Improves RPC consistency** — all playback uses `{provider}.provider.play_card(value)`
3. **Zero user migration** — legacy cards auto-detected, no manual changes needed
4. **Clear separation** — playback cards use `provider:`, command cards use `alias:`
5. **Natural path to deprecation** — old format still works but is clearly legacy
6. **Cleaner abstraction** — `PlayerMPD.play_card()` for aliases becomes legacy-only;
   the provider path is the canonical way to trigger playback

### Implementation Order

1. **Milestone 5** (Card Routing): Implement `_resolve_provider()` helper + simplified
   `decode_card_command()` with legacy auto-detection.
2. **Milestone 2** (MPD-Adapter): Add file/directory auto-detection in
   `MpdMediaProvider.play_folder()` (Solution A) for `play_single` compatibility.
3. **WebUI update**: Change card assignment to write `provider: mpd` format.
4. **Documentation**: Update all examples to show unified format.

### What Stays Dual-Format

The `decode_card_command()` still has a fallback to `utils.decode_rpc_command()` for
**command cards** (shutdown, GPIO, volume, etc.). This is intentional and correct:
command cards are fundamentally different from playback cards and should use the
existing alias infrastructure.

---

*Analysis date: 2026-07-18*
*Affected milestones: M2 (MPD-Adapter), M5 (Card Routing)*