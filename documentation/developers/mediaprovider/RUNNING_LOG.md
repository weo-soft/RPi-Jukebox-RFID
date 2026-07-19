# MediaProvider Development — Running Log

## Status Overview

```
M0 (Secrets)    ──── ✅ DONE (merged into future3/develop)
                    ├── src/jukebox/jukebox/secrets.py
                    ├── test/secrets/test_secrets.py
                    └── secrets infrastructure established
                        
M7 (Install)    ──── 🔜 NEXT (feature/mediaprovider-milestone-7)
                    ├── plugin_registry.yaml
                    ├── Plugin-Contract (repo structure, install scripts)
                    ├── Interactive plugin selection in customize_options.sh
                    ├── Generic setup_plugins.sh (clone, deps, enable)
                    ├── secrets.yaml template (chmod 600) in setup_jukebox_core.sh
                    ├── secrets.conf bootstrap in run_jukebox.sh
                    └── MQTT migration to secrets.retrieve()

M1+M2+M2b      ──── ⏳ QUEUED (feature/mediaprovider-milestone-1)
(MediaProvider      ├── PlayCardState → jukebox/callingback.py
 Interface +        ├── MediaProvider ABC + Manager
 MPD Adapter +      ├── CoverartCacheManager (mutagen)
 Cover Art)         ├── MpdMediaProvider adapter
                    ├── playermpd/PlayerMPD refactor
                    └── All tests

M5 (Card Routing) ── ⏳ QUEUED (feature/mediaprovider-milestone-5)
                    ├── decode_card_command() refactor
                    ├── _resolve_provider() with legacy auto-detect
                    ├── misc.list_providers() / get_default_provider()
                    └── jukebox.default.yaml update

M3+M4 (Jellyfin)  ── ⏳ QUEUED (feature/mediaprovider-jellyfin)
                    ├── jellyfin_api_client.py
                    ├── JellyfinMediaProvider
                    └── Plugin lifecycle + RPC

M6 (SMB)          ── ⏳ QUEUED (feature/mediaprovider-smb)
                    ├── SmbMediaProvider (gio mount, Multi-Share)
                    ├── install_dependencies.sh
                    └── configure.sh

M8+M9 (Mopidy+Spotify) ── 🗄️ DEFERRED (optional, no timeline)
```

---

## Done: Milestone 0 — Secrets Module

**Branch:** `feature/mediaprovider-milestone-0` → merged into `future3/develop`

### Delivered

| File | Art | Description |
|---|---|---|
| `src/jukebox/jukebox/secrets.py` | **New** | `store()`, `retrieve()`, `delete()`, `list_keys()` — consumer-agnostic secrets API |
| `test/secrets/__init__.py` | **New** | Empty Python package |
| `test/secrets/test_secrets.py` | **New** | 17 pytest tests |

### API Surface

```python
from jukebox.secrets import store, retrieve, delete, list_keys

retrieve(namespace, key, env_var=None, default=None)  # env > yaml > default
store(namespace, key, value)                           # writes secrets.yaml
delete(namespace, key)                                 # removes key
list_keys(namespace)                                   # safe for WebUI (no values!)
```

### Key Design Decisions (from the milestone docs)
- Backing store: `shared/settings/secrets.yaml` with `chmod 600`
- Env bootstrap: `secrets.conf` sourced by `run_jukebox.sh` (M7 will implement)
- Key-existence checks (not truthiness) — empty strings `""`, `0`, `False` are valid values
- Env-variable truthiness check — empty env variable falls through to YAML/default
- Thread-safe writes via `threading.Lock`

### Notes
- `PlayCardState` extraction was attempted on this branch but rolled back — postponed to M1
- MQTT migration to `retrieve()` is pending M7 (where the env bootstrap will be added)

---

## Next: Milestone 7 — Generic Plugin Installation Process

**Branch to create:** `feature/mediaprovider-milestone-7` from `future3/develop`

### What we're building

A **data-driven installer** that reads a plugin registry YAML and installs plugins generically — no code changes to the installer needed for new plugins.

### Implementation Plan

#### Part A: Plugin Registry + Contract

1. **`resources/default-settings/plugin_registry.yaml`** (new)
   - YAML list of plugins with `name`, `description`, `repository`, `config_key`
   - Initially empty or with a single test entry

2. **Plugin-Contract** (documented in docs, enforced by convention)
   - Plugin repo root = plugin content root (no nesting)
   - `__init__.py` with `@plugs.initialize` / `@atexit`
   - `install_dependencies.sh` (optional, system deps)
   - `requirements.txt` (optional, pip deps)
   - `configure.sh` (optional, interactive post-install config)

#### Part B: Installer Bash Changes

3. **`installation/routines/setup_plugins.sh`** (new)
   - `_setup_single_plugin()` — clone repo, run dep scripts, pip install
   - `_enable_plugins_in_config()` — add to `modules.others` via `ruamel.yaml`
   - `setup_plugins()` — main entry point

4. **`installation/routines/customize_options.sh`** — add `_option_plugins()`
   - Read `plugin_registry.yaml` via Python/ruamel.yaml
   - Show each plugin with Y/n prompt
   - Custom plugin input (name + repo URL)

5. **`installation/routines/install.sh`** — sequence `customize_options` → `setup_plugins` after `setup_jukebox_core`

6. **`installation/includes/01_default_config.sh`** — add `SELECTED_PLUGINS`, `CUSTOM_PLUGINS` vars

#### Part C: Secrets Bootstrap (from M0 docs)

7. **`installation/routines/setup_jukebox_core.sh`** — create `secrets.yaml` template with `chmod 600`

8. **`run_jukebox.sh`** — source `secrets.conf` before Python start

#### Part D: MQTT Migration to secrets.retrieve()

9. **`src/jukebox/components/mqtt/__init__.py`** — replace `cfg.setndefault()` for mqtt username/password with `retrieve('mqtt', ...)`

### Testing M7
- Unit tests for the bash functions are impractical
- Manual verification: run installer in Docker, verify plugin selection → clone → enable

### Acceptance Criteria (from the docs)
- [ ] Plugin-Registry (`plugin_registry.yaml`) defines available plugins
- [ ] `_option_plugins()` reads registry and shows per-plugin prompt
- [ ] `setup_plugins()` clones each selected plugin repo
- [ ] Plugin `install_dependencies.sh` is executed (if present)
- [ ] Plugin `requirements.txt` is pip installed (if present)
- [ ] Selected plugins are added to `modules.others` in `jukebox.yaml`
- [ ] Adding a new plugin requires only a registry entry — no installer code changes
- [ ] `secrets.yaml` created with `chmod 600` during core setup
- [ ] `run_jukebox.sh` sources `secrets.conf` before Python start
- [ ] MQTT plugin uses `retrieve()` for username/password

---

## After M7: Milestone 1+2+2b (bundled)

**Branch:** `feature/mediaprovider-milestone-1` from `future3/develop`

### What's bundled (and why)

All three share the same branch because:
- M2's `MpdMediaProvider` + playermpd changes directly depend on M1's Manager
- M2b's `CoverartCacheManager` is small (one file) and needed by both MPD and SMB
- Bundling avoids an intermediate "merged but nothing works yet" state

### Scope
1. `PlayCardState` → `jukebox/callingback.py` (with re-export for backward compat)
2. `MediaProvider` ABC + Manager → `src/jukebox/jukebox/mediaprovider/`
3. `CoverartCacheManager` → `src/jukebox/jukebox/coverart_cache.py`
4. `MpdMediaProvider` → `components/playermpd/mpd_provider.py`
5. PlayerMPD refactors: Manager-based `_last_played_folder`, `get_current_song()` cleanup, `replay()`/`replay_if_stopped()` via Manager
6. All tests

---

## Future Milestones (in order)

| Order | Milestone | Branch | Why This Order |
|-------|-----------|--------|----------------|
| 1 | M7 | `feature/mediaprovider-milestone-7` | Foundation for delivering plugins |
| 2 | M1+M2+M2b | `feature/mediaprovider-milestone-1` | Python foundation — all else depends on it |
| 3 | M5 | `feature/mediaprovider-milestone-5` | Makes cards.yaml multi-provider capable |
| 4 | M3+M4 | `feature/mediaprovider-plugin-jellyfin` | First real external plugin, installed via M7 |
| 5 | M6 | `feature/mediaprovider-plugin-smb` | Second real plugin, shows Multi-Share pattern |
| — | M8+M9 | Separate | Optional (Mopidy/Spotify), deferred |

---

## Commit Convention

Following project conventions (from AGENTS.md):
- Prefix trivial changes with `(docs)`, `(maint)`, or `(packaging)`
- Logical atomic commits
- Base work on `future3/develop` (target this branch for all milestones)

---

## IMPORTANT: Local-Only Files

The following files and directories are **NOT to be committed to version control**. They are design documents and planning artifacts intended for local development use only:

| Path | Reason |
|---|---|
| `documentation/developers/mediaprovider/` | Milestone design docs, implementation plans, running log — local planning artifacts |
| `AGENTS.md` | AI agent configuration with project-specific instructions — local development aid |

These files are **not** part of the project's public documentation for builders/end-users. The commit-ready documentation lives in `documentation/builders/` and the top-level `documentation/README.md`. Do not `git add` these files.

---

*Last updated: 2026-07-19*
