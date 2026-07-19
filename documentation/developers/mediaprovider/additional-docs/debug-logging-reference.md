# Debug Logging Reference — M7 Installer Changes

## Purpose

This document lists all `[DEBUG]` log statements added to the installation scripts
during M7 implementation. These are for diagnostic use when testing on real hardware
and **should be removed** once the M7 feature is stable and verified.

## Removal Checklist

Search for `[DEBUG]` across all modified files and remove the associated lines.
Each entry below shows the file, line context, and what to delete.

---

## File: `installation/routines/install.sh`

### `install()` entry point

```bash
# File location: ~line 2, at the start of install() function
# Search: [DEBUG] install() entered

# Lines to remove:
  log "  [DEBUG] install() entered at $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  log "  [DEBUG] INSTALLATION_PATH='${INSTALLATION_PATH}', GIT_USER='${GIT_USER}', GIT_BRANCH='${GIT_BRANCH}'"
  log "  [DEBUG] CURRENT_USER='${CURRENT_USER}', HOME_PATH='${HOME_PATH}'"
  log "  [DEBUG] SETTINGS_PATH='${SETTINGS_PATH}', VIRTUAL_ENV='${VIRTUAL_ENV}'"
  log "  [DEBUG] SELECTED_PLUGINS='${SELECTED_PLUGINS}', CUSTOM_PLUGINS='${CUSTOM_PLUGINS}'"
  log "  [DEBUG] PLUGIN_REGISTRY file exists: $(test -f "${INSTALLATION_PATH}/resources/default-settings/plugin_registry.yaml" && echo 'YES' || echo 'NO')"

# Reason: Dumps all key environment variables at install start for debugging
# which variables are available. The plugin registry check confirms the
# registry file was correctly downloaded from GitHub.
```

---

## File: `installation/routines/customize_options.sh`

### `_option_plugins()` — registry parsing

```bash
# File location: ~line 288, at the start of _option_plugins() function
# Search: [DEBUG] _option_plugins: registry_file

# Lines to remove:
  log "  [DEBUG] _option_plugins: registry_file='${registry_file}'"

# Reason: Confirms the registry file path resolves correctly.

  log "  [DEBUG] Parsed plugin entries from registry: ${plugin_entries:-'(none)'}"

# Reason: Shows what grep/awk extracted from the registry YAML. Useful for
# detecting parsing errors with the grep-based approach (no Python/venv).
```

---

## File: `installation/routines/setup_jukebox_core.sh`

### `_jukebox_core_install_settings()` — secrets.yaml creation

```bash
# File location: ~line 117, inside _jukebox_core_install_settings()
# Search: [DEBUG] _jukebox_core_install_settings

# Lines to remove:
  log "  [DEBUG] _jukebox_core_install_settings: SETTINGS_PATH='${SETTINGS_PATH}'"
  log "  [DEBUG] secrets.yaml target: '${SECRETS_FILE}'"
  log "  [DEBUG] secrets.yaml pre-exists: $(test -f "$SECRETS_FILE" && echo 'YES' || echo 'NO')"

# Reason: Confirms the secrets.yaml path and whether it's being created
# fresh or already exists from a previous install attempt.

  log "  [DEBUG] secrets.yaml created, permissions: $(ls -la "$SECRETS_FILE" 2>&1)"

# Reason: Verifies the chmod 600 applied correctly. Only executed when
# the file is newly created.

  log "  [DEBUG] secrets.yaml already exists, skipping creation"

# Reason: Only executed when the file already exists. Useful to know
# creation was skipped.
```

---

## File: `installation/routines/setup_plugins.sh`

### `_setup_single_plugin()` — per-plugin installation

```bash
# File location: ~line 23, inside _setup_single_plugin() function
# Search: [DEBUG] _setup_single_plugin

# Lines to remove:
  log "  [DEBUG] _setup_single_plugin: name='${plugin_name}', repo='${plugin_repo}', dir='${plugin_dir}'"
  log "  [DEBUG] INSTALLATION_PATH='${INSTALLATION_PATH}', VIRTUAL_ENV='${VIRTUAL_ENV}'"

# Reason: Shows which plugin is being installed, the repo URL it's cloning
# from, the target directory, and confirms VIRTUAL_ENV is set at this point.
```

---

## File: `run_jukebox.sh`

### Secrets bootstrap — secrets.conf detection

```bash
# File location: ~line 12, inside the secrets bootstrap block
# Search: [DEBUG] No secrets.conf found

# Lines to remove:
  echo "[DEBUG] No secrets.conf found at: $SECRETS_FILE" >&2

# Reason: Reports when secrets.conf is missing (this is expected/ok for
# first-time users). Uses stderr to not interfere with Python output.
```

---

## Summary

| File | `[DEBUG]` occurrences | Purpose |
|---|---|---|
| `installation/routines/install.sh` | 7 | Entry point variable dump + registry check |
| `installation/routines/customize_options.sh` | 2 | Registry parsing verification |
| `installation/routines/setup_jukebox_core.sh` | 5 | secrets.yaml creation confirmation |
| `installation/routines/setup_plugins.sh` | 2 | Per-plugin installation context |
| `run_jukebox.sh` | 1 | secrets.conf detection notice |

**To clean up:** Run `grep -rn '\[DEBUG\]' installation/ run_jukebox.sh` and remove
all matching lines.

---

*Generated: 2026-07-19*
*Part of: M7 — Generic Plugin Installation Process*