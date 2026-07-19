# Milestone 0a — Secrets Infrastructure

## Ziel

Eine **consumer-agnostische, generische** Schnittstelle zum Speichern und Abrufen von
Credentials (API-Keys, Passwörter, Tokens) in der Phoniebox future3 bereitstellen.
Jedes Plugin, der Installer und die WebUI sollen dieselbe API nutzen können.

**Dieser Meilenstein wird gemeinsam mit Milestone 0 (Prerequisites) implementiert**
und ist die Grundlage für alle Plugins, die Credentials benötigen.

## Abhängigkeiten

- Keine — dieser Meilenstein ist Teil der querschnittlichen Infrastruktur
- Wird parallel zu Milestone 0 (`PlayCardState`-Extraktion) implementiert

## Kernanforderungen

- Secrets sind **nicht** in `jukebox.yaml` sichtbar (separate Datei)
- **Store** und **Retrieve** aus jedem Kontext: Plugin-Laufzeit, WebUI
- WebUI kann Secrets **schreiben aber nicht lesen/anzeigen**
- Keine interaktive Passworteingabe beim Boot (headless-Betrieb)
- Kein Keyring, keine Hardware-Encryption — Sicherheit über Dateirechte (`chmod 600`)

---

## System-Kontext

| Eigenschaft | Wert |
|---|---|
| Service-Typ | `systemctl --user` service (`jukebox-daemon.service`) |
| Ausführungs-Benutzer | Der bei der OS-Installation erstellte User (z.B. `phoniebox`) |
| Konfigurationsordner | `shared/settings/` (via Samba erreichbar) |
| Start-Skript | `run_jukebox.sh` → `source .venv && python run_jukebox.py` |

---

## Architektur

```
┌──────────────────────────────────────────────────────────────┐
│                     Secrets Module                            │
│              src/jukebox/jukebox/secrets.py                   │
│                                                              │
│  store(namespace, key, value)   → schreibt secrets.yaml      │
│  retrieve(namespace, key)       → env > yaml > default       │
│  delete(namespace, key)         → löscht aus secrets.yaml    │
│  list_keys(namespace)           → key-namen (ohne werte!)    │
│                                                              │
│  Backing Store: shared/settings/secrets.yaml (chmod 600)     │
│  Env-Bootstrap:  shared/settings/secrets.conf (optional)     │
└──────────────────────────────────────────────────────────────┘
         ▲                ▲                ▲
         │                │                │
    ┌────┴────┐    ┌──────┴──────┐    ┌───┴───────────┐
    │Plugin   │    │Installer    │    │WebUI (RPC)     │
    │Runtime  │    │(creates     │    │write-only      │
    │         │    │ template)   │    │trigger restart │
    └─────────┘    └─────────────┘    └───────────────┘
```

> **Hinweis:** Der Installer interagiert nicht direkt mit `secrets.py` (Python ist zu
> diesem Zeitpunkt noch nicht verfügbar). Der Installer erstellt lediglich das leere
> `secrets.yaml`-Template. Secrets werden später vom Nutzer über die WebUI, RPC-CLI
> oder manuelle Bearbeitung befüllt. Die Installer-seitigen Änderungen sind in
> **Milestone 7** dokumentiert.

### Namespaces

Jedes Plugin/Component hat seinen eigenen **Namespace** — einen Top-Level-Key in
`secrets.yaml`. Das verhindert Key-Kollisionen und isoliert die Credentials logisch:

```yaml
# shared/settings/secrets.yaml
mqtt:
  username: phoniebox
  password: abc123

jellyfin:
  api_key: def456

smb:
  username: smb_user
  password: smb_pass
```

### Backing Store: `secrets.yaml`

- **Format:** YAML (via `ruamel.yaml` — bereits Projekt-Dependency)
- **Pfad:** `shared/settings/secrets.yaml` (aufgelöst relativ zum CWD `src/jukebox/`
  → `../../shared/settings/secrets.yaml`)
- **Rechte:** `chmod 600` (nur Besitzer lesbar/schreibbar)
- **Git:** Ignoriert (abgedeckt durch `shared/settings/*` in `.gitignore`)
- **Thread-Sicherheit:** Schreibzugriffe durch `threading.Lock` geschützt

### Prioritätskette bei `retrieve()`

```
1. Umgebungsvariable (aus secrets.conf)  ← höchste
2. secrets.yaml                          ← persistenter Store
3. Default-Wert (im Code)                ← niedrigste
```

### Sicherheitsmodell

Die einzige Sicherheitsmaßnahme ist das Dateirecht `chmod 600`. Kein Keyring, keine
Hardware-Encryption. Begründung: Das Threat-Model für ein headless Raspberry-Pi-Kiosk-Gerät
ist, dass ein Angreifer mit physischem Zugriff auf die SD-Karte ohnehin alle Daten lesen
kann (die Karte ist nicht verschlüsselt). Ein Angreifer mit SSH-Zugriff als anderer User
kann `chmod 600`-Dateien nicht lesen. Ein Angreifer über Samba kann sie dank `force user`
ebenfalls nicht lesen.

---

## API — `src/jukebox/jukebox/secrets.py`

### Signatur

```python
# Write (runtime, RPC)
store(namespace: str, key: str, value: str) -> None

# Read (resolves env > secrets.yaml > default)
retrieve(namespace: str, key: str,
         env_var: Optional[str] = None,
         default: Optional[str] = None) -> Optional[str]

# Delete
delete(namespace: str, key: str) -> bool

# List keys (names only, NO values exposed!)
list_keys(namespace: str) -> List[str]
```

### Nutzungsbeispiele

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

### Semantik

- `retrieve()` verwendet **Key-Existence-Checks** (`key in ns_data`). Leere Strings (`""`),
  `0`, `False` werden als gültige Werte behandelt und fallen **NICHT** an den nächsten
  Prioritätslevel durch.
- Für **Umgebungsvariablen** wird zusätzlich Truthiness geprüft (`if os.environ['VAR']:`),
  da eine leere Env-Variable typischerweise als "nicht gesetzt" zu interpretieren ist.
- Ein Secret kann nur mit `delete()` oder durch Löschen aus der YAML-Datei entfernt werden.

### Vollständige Implementierung

```python
"""
Consumer-agnostic secrets management for Phoniebox future3.

Provides a generic interface for storing and retrieving credentials
(API keys, passwords, tokens). Usable by any plugin, the installer,
and the WebUI (via RPC).
"""

import os
import threading
import logging
from pathlib import Path
from typing import Optional, List

from ruamel.yaml import YAML

import jukebox.cfghandler

logger = logging.getLogger('jb.secrets')

_write_lock = threading.Lock()
_cache: dict = {}
_cache_loaded: bool = False


def _get_secrets_path() -> Path:
    """Resolve the secrets.yaml path from jukebox configuration.

    Uses the jukebox.yaml config key 'secrets.file' (default:
    ../../shared/settings/secrets.yaml relative to the jukebox CWD).
    """
    cfg = jukebox.cfghandler.get_handler('jukebox')
    path_str = cfg.setndefault('secrets', 'file',
                               value='../../shared/settings/secrets.yaml')
    return Path(path_str)


def _load_cache() -> dict:
    global _cache, _cache_loaded
    if _cache_loaded:
        return _cache
    secrets_path = _get_secrets_path()
    if secrets_path.is_file():
        try:
            yaml = YAML(typ='safe')
            with open(secrets_path, 'r') as f:
                _cache = yaml.load(f) or {}
        except Exception as e:
            logger.error(f"Failed to load secrets.yaml: {e}")
            _cache = {}
    else:
        _cache = {}
    _cache_loaded = True
    return _cache


def _save_cache() -> None:
    global _cache
    secrets_path = _get_secrets_path()
    with _write_lock:
        secrets_path.parent.mkdir(parents=True, exist_ok=True)
        yaml = YAML(typ='safe')
        try:
            with open(secrets_path, 'w') as f:
                yaml.dump(_cache, f)
            os.chmod(secrets_path, 0o600)
        except Exception as e:
            logger.error(f"Failed to write secrets.yaml: {e}")
            raise


def _reload_cache() -> None:
    global _cache, _cache_loaded
    _cache_loaded = False
    _cache = {}
    _load_cache()


def store(namespace: str, key: str, value: str) -> None:
    _load_cache()
    if namespace not in _cache:
        _cache[namespace] = {}
    _cache[namespace][key] = value
    _save_cache()
    logger.info(f"Secret stored: '{namespace}.{key}'")


def retrieve(namespace: str, key: str,
             env_var: Optional[str] = None,
             default: Optional[str] = None) -> Optional[str]:
    if env_var and env_var in os.environ and os.environ[env_var]:
        return os.environ[env_var]

    _load_cache()
    # Support dotted namespaces (e.g. 'smb.shares.music')
    ns_data = _cache
    for part in namespace.split('.'):
        if isinstance(ns_data, dict):
            ns_data = ns_data.get(part, {})
        else:
            ns_data = {}
    if isinstance(ns_data, dict) and key in ns_data:
        return ns_data[key]

    return default


def delete(namespace: str, key: str) -> bool:
    _load_cache()
    # Walk dotted namespace path to the leaf dict
    parts = namespace.split('.')
    # Walk all parts to reach the leaf dict where the key lives
    ns_data = _cache
    for i, part in enumerate(parts):
        parent = ns_data
        if isinstance(ns_data, dict):
            ns_data = ns_data.get(part, {})
        else:
            return False
    # Now ns_data is the dict containing the key
    if not isinstance(ns_data, dict):
        return False
    if key in ns_data:
        del ns_data[key]
        if not ns_data:
            # Leaf dict is empty — remove it from parent
            leaf_name = parts[-1]
            if parent is not ns_data and isinstance(parent, dict) and leaf_name in parent:
                del parent[leaf_name]
        _save_cache()
        logger.info(f"Secret deleted: '{namespace}.{key}'")
        return True
    return False


def list_keys(namespace: str) -> List[str]:
    _load_cache()
    return sorted(_cache.get(namespace, {}).keys())
```

---

## Konkrete Code-Änderungen

### 1. MQTT-Plugin (`src/jukebox/components/mqtt/__init__.py`)

**Alt:**
```python
username = cfg.setndefault("mqtt", "username", value="phoniebox-dev")
password = cfg.setndefault("mqtt", "password", value="phoniebox-dev")
```

**Neu:**
```python
from jukebox.secrets import retrieve

username = retrieve('mqtt', 'username', env_var='MQTT_USERNAME', default='phoniebox-dev')
password = retrieve('mqtt', 'password', env_var='MQTT_PASSWORD', default=None)

if not password:
    logger.warning("MQTT password not configured. MQTT connection may fail.")
```

### 2. Jellyfin MediaProvider (M4)

```python
from jukebox.secrets import retrieve

api_key = retrieve('jellyfin', 'api_key', env_var='JELLYFIN_API_KEY', default=None)
```

### 3. SMB MediaProvider (M6)

```python
from jukebox.secrets import retrieve

username = retrieve('smb', 'username', env_var='SMB_USERNAME', default='guest')
password = retrieve('smb', 'password', env_var='SMB_PASSWORD', default='')
```

### 4. Spotify MediaProvider (M9, optional)

```python
from jukebox.secrets import retrieve

client_id = retrieve('spotify', 'client_id', env_var='SPOTIFY_CLIENT_ID', default=None)
client_secret = retrieve('spotify', 'client_secret', env_var='SPOTIFY_CLIENT_SECRET', default=None)
```

---

## Installer-Änderungen (via Milestone 7)

### `run_jukebox.sh` — Env-Bootstrap

```bash
# Vor dem Start des Python-Prozesses:
SECRETS_FILE="$PROJECT_ROOT/shared/settings/secrets.conf"
if [ -f "$SECRETS_FILE" ] && [ -r "$SECRETS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$SECRETS_FILE"
  set +a
fi
```

### `secrets.conf` — Vorlage (optional)

```bash
# Jukebox Secrets — NEVER commit this file to version control!
# Diese Datei wird von run_jukebox.sh vor dem Python-Start gesourced.
# Umgebungsvariablen haben HÖCHSTE Priorität bei retrieve().

MQTT_USERNAME=phoniebox
MQTT_PASSWORD=geheim
JELLYFIN_API_KEY=abc123def456
SMB_USERNAME=smb_user
SMB_PASSWORD=smb_geheim
```

### `setup_jukebox_core.sh` — `secrets.yaml`-Template erstellen

In `_jukebox_core_install_settings()`:

```bash
# secrets.yaml als leeres YAML-Dokument erstellen
local SECRETS_FILE="${SETTINGS_PATH}/secrets.yaml"
if [ ! -f "$SECRETS_FILE" ]; then
  echo "{}" > "$SECRETS_FILE"
  chmod 600 "$SECRETS_FILE"
  print_lc "  Created secrets.yaml: ${SECRETS_FILE}"
fi
```

Verifikation in `_jukebox_core_check()`:

```bash
verify_files_chmod_chown 644 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/jukebox.yaml"
verify_files_chmod_chown 600 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/secrets.yaml"
verify_files_chmod_chown 644 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/logger.yaml"
```

> **Wichtig:** `jukebox.yaml` behält `chmod 644` (allgemeine Konfiguration, lesbar via
> Samba). Nur `secrets.yaml` erhält `chmod 600`.

### `setup_samba.sh` — `force user` für `chmod 600`-Kompatibilität

```bash
[phoniebox]
  ...
  force user = ${CURRENT_USER}
```

Ohne `force user` laufen Samba-Zugriffe unter dem Samba-Gast und können `chmod 600`-Dateien
nicht lesen. `force user` zwingt alle Zugriffe unter dem Datei-Besitzer auszuführen.

---

## Migrationspfad

| Komponente | Migration | Rückwärtskompatibilität |
|---|---|---|
| **MQTT** | `cfg.setndefault(...)` → `retrieve(...)` | Keine automatische Migration. MQTT ist `enabled: false` per Default. |
| **Jellyfin** (geplant) | `cfg.getn('jellyfin', 'api_key')` → `retrieve('jellyfin', 'api_key')` | Keine. Plugin existiert noch nicht in der Codebase. |
| **SMB** (geplant) | `retrieve()` für Credentials zu externen SMB-Servern | Im SMB-Plugin-Plan (M6) dokumentiert. |

**Umstellungsreihenfolge für Nutzer:**
1. Secrets-Modul wird installiert
2. Leeres `secrets.yaml`-Template wird angelegt (`shared/settings/secrets.yaml`, initial `{}`)
3. Nutzer trägt Credentials wahlweise in `secrets.yaml` ODER `secrets.conf` ein
4. Beim nächsten Daemon-Start verwendet das Plugin die neuen Werte

---

## WebUI / RPC-Anbindung (späterer Schritt)

**Prinzip:** WebUI darf Secrets **schreiben aber nicht lesen**.

| RPC Endpoint | Zugriff | Beschreibung |
|---|---|---|
| `secrets.store` | Write | Speichert ein Secret (überschreibt existierende) |
| `secrets.delete` | Write | Löscht ein Secret |
| `secrets.list_keys` | Read | Gibt Key-Namen zurück (KEINE Werte!) |
| `secrets.retrieve` | **Intern** | Nicht via RPC exponiert |

Nach einem `store`/`delete` über die WebUI muss der Daemon neu gestartet werden, damit
die Plugins die neuen Credentials laden. Dies kann via RPC-Befehl an `hostif.linux`
erfolgen: `hostif.linux.restart_service('jukebox-daemon')`.

> **Hinweis:** Die RPC-Exponierung ist ein Folgeschritt und nicht Teil dieser initialen
> Implementierung. Das Secrets-Modul selbst ist RPC-agnostisch designed.

---

## Neue Dateien

| Datei | Art | Beschreibung |
|---|---|---|
| `src/jukebox/jukebox/secrets.py` | **Neu** | `store()`, `retrieve()`, `delete()`, `list_keys()` |
| `test/secrets/__init__.py` | **Neu** | Leer (Python package) |
| `test/secrets/test_secrets.py` | **Neu** | pytest-Tests (17 Tests, siehe unten) |

## Geänderte Dateien (alle Teil dieses Meilensteins + M7)

| Datei | Art | Beschreibung |
|---|---|---|
| `run_jukebox.sh` | Änderung | `source secrets.conf` vor Python-Start (Env-Bootstrap) |
| `src/jukebox/components/mqtt/__init__.py` | Änderung | `retrieve()` für username/password |
| `installation/routines/setup_jukebox_core.sh` | Änderung | `secrets.yaml`-Template erstellen (`chmod 600`) |
| `installation/routines/setup_samba.sh` | Änderung | Interaktive Samba-Passwort-Auswahl; `force user` |

---

## Tests

### `test/secrets/test_secrets.py` (17 Tests)

- `store()` / `retrieve()` round-trip
- `store()` mit mehreren Namespaces
- `store()` überschreibt existierende Werte
- `retrieve()` mit gesetzter Umgebungsvariable → env var gewinnt
- `retrieve()` ohne Umgebungsvariable → YAML-Fallback
- `retrieve()` ohne beides → default
- `retrieve()` ohne beides und ohne default → None
- Leere Env-Variable → fällt durch zu YAML
- Empty string als stored value → wird zurückgegeben (nicht ignoriert)
- `0` als stored value → wird zurückgegeben
- `False` als stored value → wird zurückgegeben
- `delete()` existierender Key → True, `retrieve()` → None
- `delete()` nicht-existierender Key → False
- `delete()` letzter Key in Namespace → Namespace wird entfernt
- `list_keys()` gibt nur Key-Namen zurück (keine Werte!)
- `list_keys()` für leeren Namespace → `[]`
- Cache-Persistenz über `_reload_cache()`

---

## Akzeptanzkriterien

- [ ] `store()`, `retrieve()`, `delete()`, `list_keys()` sind via `from jukebox.secrets import ...` importierbar
- [ ] `retrieve()` wertet Environment-Variablen vor `secrets.yaml` vor Default aus
- [ ] `secrets.yaml` wird mit `chmod 600` erstellt (via Installer, siehe M7)
- [ ] `run_jukebox.sh` sourced `secrets.conf` vor dem Python-Start (Env-Bootstrap, siehe M7)
- [ ] `list_keys()` gibt NUR Key-Namen zurück, keine Werte (WebUI-sicher)
- [ ] MQTT-Plugin verwendet `retrieve()` für username/password
- [ ] Jellyfin-Plugin (M4) verwendet `retrieve()` für API-Key
- [ ] SMB-Plugin (M6) verwendet `retrieve()` für Username/Password
- [ ] Alle 17 pytest-Tests laufen grün

## Was NICHT in diesem Meilenstein enthalten ist

| Thema | Begründung |
|---|---|
| RPC/WebSocket-Authentifizierung | Eigenes, größeres Thema |
| GVFS-Keyring | Nur mit Kiosk-Mode/D-Bus möglich |
| Hardware-bound Encryption | Zu komplex für initiale Verbesserung |
| `.env`-Datei + `python-dotenv` | Zusätzliche Dependency nicht nötig |
| RPC-Endpunkte für `secrets.*` | Folgeschritt — Secrets-Modul ist RPC-agnostisch |
| Automatischer Daemon-Restart nach Secret-Update | Folgeschritt — WebUI triggert Restart via `hostif` |