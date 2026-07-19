# Milestone 0 — Prerequisites: Cross-Cutting Infrastructure

## Ziel

Eine querschnittliche Änderung bereitstellen, die von fast allen anderen Meilensteinen
benötigt wird:

1. **`jukebox.secrets`** — `retrieve()`, `store()`, `delete()`, `list_keys()` für consumer-agnostisches Secret-Management

## Abhängigkeiten

- Keine — dieser Meilenstein ist die Grundlage für alle anderen

## Scope — Teil 1: `jukebox.secrets` Modul

Das Secrets-Modul wird als vollständige, consumer-agnostische Schnittstelle
implementiert. Die **vollständige Spezifikation** inklusive API, Backing Store
(`secrets.yaml` mit `chmod 600`), Env-Bootstrap (`secrets.conf`), Thread-Sicherheit
und Migrationspfad befindet sich in:

→ **[`documentation/developers/mediaprovider/00a-secrets-infrastructure.md`](00a-secrets-infrastructure.md)**

### Zusammenfassung der API

```python
from jukebox.secrets import store, retrieve, delete, list_keys

# Secret speichern (Plugin-Laufzeit, WebUI via RPC)
store('jellyfin', 'api_key', 'abc123')

# Secret abrufen (Priorität: env > secrets.yaml > default)
api_key = retrieve('jellyfin', 'api_key', env_var='JELLYFIN_API_KEY', default=None)

# Secret löschen
delete('jellyfin', 'api_key')

# Key-Namen auflisten (KEINE Werte — sicher für WebUI)
keys = list_keys('jellyfin')  # → ['api_key', 'username']
```

### Kernunterschiede zur ursprünglichen `get_secret()`-Planung

| Aspekt | Ursprünglich (`get_secret`) | Final (`secrets.py`) |
|---|---|---|
| API | `get_secret(cfg, config_key, sub_key, env_var, default)` | `store()`, `retrieve()`, `delete()`, `list_keys()` |
| Backing Store | Keiner (nur env + YAML-Fallback) | `secrets.yaml` (chmod 600) |
| WebUI-Schreibzugriff | Nicht vorgesehen | `store()`/`delete()` via RPC (write-only) |
| Falsy-Values | Truthiness-Check (leer = nicht gesetzt) | Key-Existence-Check (leer = gültig) |
| Migrationspfad | Keiner dokumentiert | Pro Komponente dokumentiert |

### Was aus diesem Meilenstein erhalten bleibt

Die folgenden Installer-bezogenen Änderungen aus der ursprünglichen Planung
werden in **Milestone 7 (Installer Integration)** übernommen:

- **`run_jukebox.sh`** sourced `secrets.conf` vor dem Python-Start (Env-Bootstrap)
- **`setup_jukebox_core.sh`** erstellt leeres `secrets.yaml`-Template mit `chmod 600`
- **`secrets.conf`**-Vorlage wird in `shared/settings/` abgelegt

### Plugins, die `jukebox.secrets` verwenden

| Plugin | Verwendung |
|---|---|
| MQTT (bestehend) | `retrieve('mqtt', 'password', env_var='MQTT_PASSWORD')` |
| Jellyfin (M4) | `retrieve('jellyfin', 'api_key', env_var='JELLYFIN_API_KEY')` |
| SMB (M6) | `retrieve('smb', 'username', ...)`, `retrieve('smb', 'password', ...)` |
| Spotify (M9, optional) | `retrieve('spotify', 'client_id', ...)`, `retrieve('spotify', 'client_secret', ...)` |
### Geändert: `installation/routines/setup_jukebox_core.sh` — `secrets.yaml` Template + `chmod 600`

In `_jukebox_core_install_settings()` wird das `secrets.yaml`-Template erstellt
(`chmod 600`). `jukebox.yaml` behält `chmod 644` (nur `secrets.yaml` ist restriktiv).

**Siehe [00a-secrets-infrastructure.md](00a-secrets-infrastructure.md) Abschnitt "Installer: secrets.yaml-Template erstellen"**
für die vollständige Implementierung.

Die Verifikation in `_jukebox_core_check()`:
```bash
verify_files_chmod_chown 644 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/jukebox.yaml"
verify_files_chmod_chown 600 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/secrets.yaml"
```

### Neu: `shared/settings/secrets.conf` (leere Vorlage)

```bash
# Jukebox Secrets — NEVER commit this file to version control!
# This file is sourced by run_jukebox.sh to set environment variables
# before the Python process starts.
#
# Add your secrets here:
#
# JELLYFIN_API_KEY=your_api_key_here
# SMB_USERNAME=your_smb_user
# SMB_PASSWORD=your_smb_password
# MQTT_PASSWORD=your_mqtt_password
```

## Auswirkungen auf andere Meilensteine

| Meilenstein | Verwendet | Anmerkung |
|---|---|---|
| M3 (Jellyfin API Client) | `retrieve()` aus `jukebox.secrets` | Für API-Key-Resolution |
| M4 (Jellyfin Plugin) | `retrieve()`, `store()` aus `jukebox.secrets` | Für API-Key-Resolution + WebUI-Konfiguration |
| M6 (SMB Plugin) | `retrieve()` aus `jukebox.secrets` | Für Username/Password-Resolution |
| M7 (Installer Integration) | `secrets.yaml`-Template-Erstellung | `chmod 600`, `secrets.conf`-Bootstrap |
| M9 (Spotify, optional) | `retrieve()` aus `jukebox.secrets` | Für Client-ID/Secret-Resolution |

## Tests

### Test: `test/secrets/test_secrets.py`

Die vollständige Test-Suite (17 Tests) ist in
**[`00a-secrets-infrastructure.md`](00a-secrets-infrastructure.md)** dokumentiert und umfasst:

- `store()` / `retrieve()` round-trip
- Env-Variablen-Override (`retrieve()` mit `env_var`)
- Key-Existence-Checks (falsy values wie `""`, `0`, `False` sind gültig)
- Leere Env-Variablen fallen durch (Truthiness-Check für env)
- `delete()` + `list_keys()` (KEINE Werte exposed)
- Cache-Persistenz über `_reload_cache()`

## Akzeptanzkriterien

- [ ] `store()`, `retrieve()`, `delete()`, `list_keys()` sind via `from jukebox.secrets import ...` importierbar
- [ ] `retrieve()` wertet Environment-Variablen vor `secrets.yaml` vor Default aus
- [ ] `secrets.yaml` wird mit `chmod 600` erstellt (via Installer, M7)
- [ ] `run_jukebox.sh` sourced `secrets.conf` vor dem Python-Start (Env-Bootstrap, M7)
- [ ] `list_keys()` gibt NUR Key-Namen zurück, keine Werte (WebUI-sicher)