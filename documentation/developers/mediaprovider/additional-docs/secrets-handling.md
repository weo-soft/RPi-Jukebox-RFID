# Secrets Handling — Implementation Plan

## Ziel

Eine **consumer-agnostische, generische** Schnittstelle zum Speichern und Abrufen von Credentials (API-Keys, Passwörter, Tokens) in der Phoniebox future3. Jedes Plugin, der Installer und die WebUI sollen dieselbe API nutzen können.

> **Integration in den MediaProvider-Plan:**
> Dieses Secrets-Modul ist integraler Bestandteil des
> **[MediaProvider-Implementierungsplans](mediaprovider/README.md)**.
> Es wird in **Milestone 0 (Prerequisites)** als `jukebox.secrets` implementiert.
> Die Installer-seitigen Änderungen (`secrets.yaml`-Template, `secrets.conf`-Bootstrap,
> `chmod 600`-Verifikation) werden in **Milestone 7 (Installer Integration)**
> umgesetzt. Konkrete Plugins (Jellyfin M4, SMB M6) verwenden die
> `retrieve()`/`store()`/`delete()`/`list_keys()` API.
>
> Siehe **[mediaprovider/00-prerequisites.md](mediaprovider/00-prerequisites.md)** für die
> Integration in den Milestone-Plan.

**Kernanforderungen:**
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
| Kiosk-Mode | **Nicht aktiv** (kein X11, kein D-Bus Session Bus) |

---

## Status Quo: Gefundene Probleme

1. **MQTT-Passwort als hartkodierter Default** (`src/jukebox/components/mqtt/__init__.py:213`):
   ```python
   password = cfg.setndefault("mqtt", "password", value="phoniebox-dev")
   ```

2. **Jellyfin API-Key im YAML-Klartext** (geplant in `04-jellyfin-plugin.md`):
   ```yaml
   jellyfin:
     api_key: your-api-key-here
   ```

3. **Samba-Installer mit hartkodiertem Passwort** (`installation/routines/setup_samba.sh:18`):
   ```bash
   local SMB_PASSWD="raspberry"
   ```

4. **Keine Authentifizierung auf RPC/WebSocket** (ZeroMQ Ports 5555-5558 offen)
   → Nicht Teil dieses Plans. Eigenes, größeres Thema.

> **Hinweis:** SMB-MediaProvider Credential-Handling (`gio mount`) ist **nicht** Teil dieses Plans. Das wird im SMB-Plugin-Plan (`documentation/developers/mediaprovider/06-smb-plugin.md`) separat behandelt.

---

## Architektur

### Konzept

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

> **Hinweis:** Der Installer interagiert nicht direkt mit `secrets.py` (Python ist zu diesem Zeitpunkt noch nicht verfügbar). Der Installer erstellt lediglich das leere `secrets.yaml`-Template. Secrets werden später vom Nutzer über die WebUI, RPC-CLI oder manuelle Bearbeitung befüllt.

### Namespaces

Jedes Plugin/Component hat seinen eigenen **Namespace** — einen Top-Level-Key in `secrets.yaml`. Das verhindert Key-Kollisionen und isoliert die Credentials logisch:

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
- **Pfad:** `shared/settings/secrets.yaml` (aufgelöst relativ zum CWD `src/jukebox/` → `../../shared/settings/secrets.yaml`)
- **Rechte:** `chmod 600` (nur Besitzer lesbar/schreibbar)
- **Git:** Ignoriert (abgedeckt durch `shared/settings/*` in `.gitignore`)
- **Thread-Sicherheit:** Schreibzugriffe durch `threading.Lock` geschützt
- **Race condition Hinweis:** Die `store()`-Operation besteht aus Read-Modify-Write (`_load_cache` → modifizieren → `_save_cache`). Unter extrem hoher Last könnten zwei gleichzeitige `store()`-Aufrufe sich überschreiben (Lost-Update). Da Secrets-Schreibvorgänge extrem selten sind (Nutzer-Konfiguration, kein Hot-Path), wird dieses Risiko akzeptiert. Eine Lösung wäre das Erweitern des Locks auf die gesamte Read-Modify-Write-Operation, was bei Bedarf nachgerüstet werden kann.

### Warum kein Keyring / keine Verschlüsselung?

Die einzige Sicherheitsmaßnahme ist das Dateirecht `chmod 600`. Das ist eine bewusste Design-Entscheidung:

| Alternative | Warum nicht geeignet |
|---|---|
| **freedesktop Secret Service / GNOME Keyring / KDE Wallet** | Benötigt einen laufenden D-Bus Session Bus, der im headless `systemctl --user`-Betrieb dieser Anwendung nicht verfügbar ist (kein Kiosk-Mode, kein X11). |
| **Hardware-bound Encryption (TPM, CPU-Serial)** | Bietet theoretisch stärkeren Schutz, aber: (1) erfordert zusätzliche System-Dependencies, (2) Recovery nach SD-Karten-Tausch wird komplex, (3) für ein Single-User-Kiosk-Gerät ohne interaktiven Login ist der Mehrwert minimal. |
| **Master-Passwort / Boot-Time-Entry** | Nicht möglich: Das Gerät läuft headless ohne Display und Tastatur. Eine Passwortabfrage beim Boot würde den unbeaufsichtigten Start verhindern. |
| **Verschlüsselte Secrets auf Disk (gpg, age, openssl enc)** | Erfordert einen Schlüssel, der selbst wieder irgendwo unverschlüsselt liegen muss (Chicken-and-Egg-Problem). Ohne TPM oder Benutzereingabe beim Boot ist der Schlüssel letztlich doch auf derselben SD-Karte gespeichert — also kein Sicherheitsgewinn gegenüber `chmod 600`, aber deutlich mehr Komplexität. |

**Fazit:** Das Threat-Model für ein headless Raspberry-Pi-Kiosk-Gerät ist: Ein Angreifer mit physischem Zugriff auf die SD-Karte kann ohnehin alle Daten lesen (die Karte ist nicht verschlüsselt). Ein Angreifer mit SSH-Zugriff als anderer User kann `chmod 600`-Dateien nicht lesen. Ein Angreifer über Samba kann sie dank `force user` ebenfalls nicht lesen. Damit ist `chmod 600` die angemessene Sicherheitsstufe.

### Env-Bootstrap (optional)

Zusätzlich kann `run_jukebox.sh` eine optionale `secrets.conf` sourcen. Die daraus exportierten Umgebungsvariablen haben **höchste Priorität** bei `retrieve()`. Dies erlaubt Pre-Seeding von Secrets ohne die YAML-Datei zu berühren (z.B. in Docker-Containern oder CI/CD).

```
Priorität bei retrieve():
  1. Umgebungsvariable (aus secrets.conf)  ← höchste
  2. secrets.yaml                          ← persistenter Store
  3. Default-Wert (im Code)                ← niedrigste
```

**Begründung für Env-Bootstrap:** Ein Builder kann Credentials in `secrets.conf` vorkonfigurieren (die Datei existiert nur lokal, nie im Repo). Der Python-Code kann sie **nicht** lesen (keine secrets!), aber beim Daemon-Start werden sie als Env-Vars geladen und überschatten die YAML-Werte.

---

## API — `src/jukebox/jukebox/secrets.py`

```python
"""
Consumer-agnostic secrets management for Phoniebox future3.

Provides a generic interface for storing and retrieving credentials
(API keys, passwords, tokens). Usable by any plugin, the installer,
and the WebUI (via RPC).

Namespaces:
    Each plugin has its own namespace (top-level key in secrets.yaml).
    Example: 'mqtt', 'jellyfin', 'smb', 'spotify'

Backing store: ../../shared/settings/secrets.yaml (YAML, chmod 600)
Bootstrap:      ../../shared/settings/secrets.conf (optional shell env file)

Retrieval priority: Environment variable > secrets.yaml > default

Usage:
    from jukebox.secrets import store, retrieve, delete, list_keys

    # Write (runtime, RPC)
    store('mqtt', 'password', 'abc123')

    # Read (resolves env > yaml > default)
    pwd = retrieve('mqtt', 'password', default=None)

    # Delete
    delete('mqtt', 'password')

    # List keys (names only, NO values exposed!)
    keys = list_keys('mqtt')  # → ['username', 'password']

.. note::

    retrieve() verwendet Key-Existence-Checks (``key in ns_data``).
    Leere Strings (``''``), ``0``, ``False`` werden als gültige Werte behandelt
    und NICHT an den nächsten Prioritätslevel durchgereicht! Ein Secret kann
    nur mit ``delete()`` oder durch Löschen aus der YAML-Datei entfernt werden.

    Für Umgebungsvariablen wird zusätzlich Truthiness geprüft (``if os.environ['VAR']:``),
    da eine leere Env-Variable typischerweise als "nicht gesetzt" zu interpretieren ist.
"""

import os
import threading
import logging
from pathlib import Path
from typing import Optional, List

from ruamel.yaml import YAML

logger = logging.getLogger('jb.secrets')

# Path to the secrets YAML file.
# Resolved relative to CWD (src/jukebox/), guaranteed by run_jukebox.sh.
_SECRETS_YAML_PATH = Path('../../shared/settings/secrets.yaml')

# Write lock for file I/O serialization.
# Note: Read-Modify-Write in store() is NOT fully atomic.
# Two concurrent store() calls may result in a lost update
# (acceptable tradeoff — secrets writes are extremely rare).
_write_lock = threading.Lock()

# In-memory cache of the YAML data
_cache: dict = {}
_cache_loaded: bool = False


def _load_cache() -> dict:
    """Load secrets.yaml into memory cache. Returns empty dict if file missing."""
    global _cache, _cache_loaded
    if _cache_loaded:
        return _cache

    if _SECRETS_YAML_PATH.is_file():
        try:
            yaml = YAML(typ='safe')
            with open(_SECRETS_YAML_PATH, 'r') as f:
                _cache = yaml.load(f) or {}
        except Exception as e:
            logger.error(f"Failed to load secrets.yaml: {e}")
            _cache = {}
    else:
        _cache = {}
    _cache_loaded = True
    return _cache


def _save_cache() -> None:
    """Persist in-memory cache to secrets.yaml."""
    global _cache
    with _write_lock:
        _SECRETS_YAML_PATH.parent.mkdir(parents=True, exist_ok=True)
        yaml = YAML(typ='safe')
        try:
            with open(_SECRETS_YAML_PATH, 'w') as f:
                yaml.dump(_cache, f)
            os.chmod(_SECRETS_YAML_PATH, 0o600)
        except Exception as e:
            logger.error(f"Failed to write secrets.yaml: {e}")
            raise


def _reload_cache() -> None:
    """Force reload from disk (used after external modifications)."""
    global _cache, _cache_loaded
    _cache_loaded = False
    _cache = {}
    _load_cache()


def store(namespace: str, key: str, value: str) -> None:
    """
    Store a secret value under the given namespace and key.

    Writes immediately to secrets.yaml (chmod 600).

    :param namespace: Top-level key in secrets.yaml (e.g., 'mqtt')
    :param key: Secret key name (e.g., 'password')
    :param value: Secret value to store
    """
    _load_cache()
    if namespace not in _cache:
        _cache[namespace] = {}
    _cache[namespace][key] = value
    _save_cache()
    logger.info(f"Secret stored: '{namespace}.{key}'")


def retrieve(namespace: str, key: str,
             env_var: Optional[str] = None,
             default: Optional[str] = None) -> Optional[str]:
    """
    Retrieve a secret with priority: Environment > secrets.yaml > default.

    Uses key-existence checks for secrets.yaml (falsy values like "",
    0, False are treated as valid). Environment variables additionally
    require a truthy value (empty env vars fall through to the next level).

    :param namespace: Top-level key in secrets.yaml (e.g., 'mqtt')
    :param key: Secret key name (e.g., 'password')
    :param env_var: Optional env variable name for override (e.g., 'MQTT_PASSWORD')
    :param default: Fallback value if secret is not found anywhere
    :return: The secret value or None
    """
    # 1. Environment variable (highest priority)
    #    Must exist AND be non-empty. An empty env var falls through.
    if env_var and env_var in os.environ and os.environ[env_var]:
        logger.debug(f"Secret '{namespace}.{key}' resolved from env '{env_var}'")
        return os.environ[env_var]

    # 2. secrets.yaml — key existence check (no truthiness)
    _load_cache()
    ns_data = _cache.get(namespace, {})
    if key in ns_data:
        logger.debug(f"Secret '{namespace}.{key}' resolved from secrets.yaml")
        return ns_data[key]

    # 3. Default
    if default is not None:
        logger.debug(f"Secret '{namespace}.{key}' using default value")
        return default

    logger.debug(f"Secret '{namespace}.{key}' not set")
    return None


def delete(namespace: str, key: str) -> bool:
    """
    Delete a secret from secrets.yaml.

    :param namespace: Top-level key in secrets.yaml
    :param key: Secret key to remove
    :return: True if the key existed and was deleted, False otherwise
    """
    _load_cache()
    ns_data = _cache.get(namespace, {})
    if key in ns_data:
        del ns_data[key]
        # Remove namespace if empty
        if not ns_data:
            del _cache[namespace]
        _save_cache()
        logger.info(f"Secret deleted: '{namespace}.{key}'")
        return True
    logger.debug(f"Secret '{namespace}.{key}' not found, nothing to delete")
    return False


def list_keys(namespace: str) -> List[str]:
    """
    List all key names in a namespace. Values are NEVER returned.

    Safe to expose via RPC/WebUI — only key names, no secret values.

    :param namespace: Top-level key in secrets.yaml
    :return: List of key names (e.g., ['username', 'password'])
    """
    _load_cache()
    ns_data = _cache.get(namespace, {})
    return sorted(ns_data.keys())
```

---

## Konkrete Code-Änderungen

### 1. MQTT-Plugin (`src/jukebox/components/mqtt/__init__.py`)

**Alt (Zeile 212-213):**
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

### 2. Jellyfin MediaProvider (`04-jellyfin-plugin.md`)

**Alt:**
```python
api_key = cfg.getn('jellyfin', 'api_key', default=None)
```

**Neu:**
```python
from jukebox.secrets import retrieve

api_key = retrieve('jellyfin', 'api_key', env_var='JELLYFIN_API_KEY', default=None)
```

### 3. Samba-Installer (`installation/routines/setup_samba.sh`)

**Alt:**
```bash
local SMB_PASSWD="raspberry"
```

**Neu — interaktive Passwort-Auswahl:**
```bash
_samba_set_user() {
  print_lc "  Configure Samba"

  # Samba has not been configured
  if grep -q "$SMB_CONF_HEADER" "$SMB_CONF"; then
    print_lc "    Skipping. Already set up!"
  else
    # === NEU: Interaktive Passwort-Auswahl ===
    print_lc ""
    print_lc "  Samba password for accessing the shared folder:"
    print_lc "    [1] Use default password (raspberry)"
    print_lc "    [2] Generate a random password"
    print_lc "    [3] Enter your own password"
    read -r -p "  Choose [1-3]: " SMB_PW_CHOICE

    case "${SMB_PW_CHOICE}" in
      2)
        local SMB_PASSWD
        SMB_PASSWD=$(openssl rand -base64 12)
        print_c "  Random password: ${SMB_PASSWD}"
        print_c "  Please note this password! It is shown only once."
        ;;
      3)
        read -r -s -p "  Enter password: " SMB_PASSWD
        echo ""
        read -r -s -p "  Confirm password: " SMB_PASSWD_CONFIRM
        echo ""
        if [[ "${SMB_PASSWD}" != "${SMB_PASSWD_CONFIRM}" ]]; then
          print_lc "  ERROR: Passwords do not match. Using default."
          local SMB_PASSWD="raspberry"
        fi
        ;;
      *)
        print_lc "  Using default password (raspberry)."
        local SMB_PASSWD="raspberry"
        ;;
    esac
    # ==========================================

    # Create Samba user
    (echo "${SMB_PASSWD}"; echo "${SMB_PASSWD}") | sudo smbpasswd -s -a "${CURRENT_USER}"

    sudo chown root:root $SMB_CONF
    sudo chmod 777 $SMB_CONF

    # Create Samba Mount Points
    sudo cat << EOF >> $SMB_CONF
${SMB_CONF_HEADER}
[phoniebox]
  comment=Pi Jukebox
  path=${SHARED_PATH}
  browseable=Yes
  writeable=Yes
  only guest=no
  create mask=0777
  directory mask=0777
  public=no
  force user = ${CURRENT_USER}
EOF

    sudo chmod 644 $SMB_CONF
  fi
}
```

> **Hinweis:** Dieses Passwort ist für den **lokalen Samba-Share** (Builder-Zugriff auf `shared/`). Es ist **nicht** dasselbe wie SMB-Credentials in `secrets.yaml` (für externe SMB-Server-Verbindungen).

### 4. Installer: `secrets.yaml`-Template erstellen

In `installation/routines/setup_jukebox_core.sh`, Funktion `_jukebox_core_install_settings()`:

```bash
_jukebox_core_install_settings() {
  print_lc "  Register Jukebox settings"
  cp -f "${INSTALLATION_PATH}/resources/default-settings/jukebox.default.yaml" "${SETTINGS_PATH}/jukebox.yaml"
  cp -f "${INSTALLATION_PATH}/resources/default-settings/logger.default.yaml" "${SETTINGS_PATH}/logger.yaml"

  # === NEU: secrets.yaml als leeres YAML-Dokument erstellen ===
  local SECRETS_FILE="${SETTINGS_PATH}/secrets.yaml"
  if [ ! -f "$SECRETS_FILE" ]; then
    echo "{}" > "$SECRETS_FILE"
    chmod 600 "$SECRETS_FILE"
    print_lc "  Created secrets.yaml: ${SECRETS_FILE}"
  fi
  # ===========================================================
}
```

Verifikation in `_jukebox_core_check()`:

```bash
verify_files_chmod_chown 644 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/jukebox.yaml"
verify_files_chmod_chown 600 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/secrets.yaml"
verify_files_chmod_chown 644 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/logger.yaml"
```

> **Wichtig:** `jukebox.yaml` behält `chmod 644` (allgemeine Konfiguration, lesbar via Samba). Nur `secrets.yaml` erhält `chmod 600`.

### 5. Samba `force user` für `chmod 600`-Kompatibilität

In `installation/routines/setup_samba.sh`, Funktion `_samba_set_user()`, die `cat << EOF` Sektion:

```bash
sudo cat << EOF >> $SMB_CONF
${SMB_CONF_HEADER}
[phoniebox]
  comment=Pi Jukebox
  path=${SHARED_PATH}
  browseable=Yes
  writeable=Yes
  only guest=no
  create mask=0777
  directory mask=0777
  public=no
  force user = ${CURRENT_USER}
EOF
```

**Hintergrund:** Ohne `force user` laufen Samba-Zugriffe unter dem Samba-Gast und können `chmod 600`-Dateien nicht lesen. `force user` zwingt alle Zugriffe unter dem Datei-Besitzer auszuführen.

---

## Env-Bootstrap via `run_jukebox.sh`

```bash
#!/usr/bin/env bash

SOURCE=${BASH_SOURCE[0]}
SCRIPT_DIR="$(dirname "$SOURCE")"
PROJECT_ROOT="$SCRIPT_DIR"
cd "$PROJECT_ROOT" || { echo "Could not change directory"; exit 1; }

# === NEU: Secrets-Datei laden (optional) ===
SECRETS_FILE="$PROJECT_ROOT/shared/settings/secrets.conf"
if [ -f "$SECRETS_FILE" ] && [ -r "$SECRETS_FILE" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$SECRETS_FILE"
  set +a
fi
# ==========================================

source .venv/bin/activate || { echo "ERROR: Failed to activate virtual environment"; exit 1; }

cd src/jukebox || { echo "Could not change directory"; exit 1; }
python run_jukebox.py $@
```

**`secrets.conf` (Beispiel, optional):**
```bash
# Secrets-Bootstrap für Phoniebox future3
# Diese Datei wird von run_jukebox.sh vor dem Python-Start gesourced.
# Umgebungsvariablen haben HÖCHSTE Priorität bei retrieve().
#
# WICHTIG: Werte mit Sonderzeichen in einfache Anführungszeichen setzen:
#   MQTT_PASSWORD='p@$$w0rd with spaces'

MQTT_USERNAME=phoniebox
MQTT_PASSWORD=geheim
JELLYFIN_API_KEY=abc123def456
```

---

## Migrationspfad für bestehende Komponenten

Das Secrets-Modul wird als neue Core-Komponente eingeführt. Bestehende Komponenten werden wie folgt migriert:

### Komponenten, die auf `secrets.py` migrieren (Python)

| Komponente | Datei | Migration | Rückwärtskompatibilität |
|---|---|---|---|
| **MQTT** | `src/jukebox/components/mqtt/__init__.py` | `cfg.setndefault(...)` → `retrieve(...)` | **Keine.** Bestehende MQTT-Credentials aus `jukebox.yaml` werden *nicht* automatisch migriert. Nutzer müssen ihre Credentials manuell in `secrets.yaml` oder `secrets.conf` übertragen. Dies ist akzeptabel, da (a) der Installer keine In-Place-Upgrades unterstützt (`_check_existing_installation`), (b) MQTT `enable: false` per Default ist und (c) der Installer aktuell kein MQTT-Setup anbietet. |
| **Jellyfin** | `src/jukebox/components/jellyfin/` (geplant) | `cfg.getn('jellyfin', 'api_key')` → `retrieve('jellyfin', 'api_key')` | **Keine.** Gleiche Begründung wie MQTT. Das Plugin existiert noch nicht in der Codebase, daher gibt es keine bestehenden Nutzer zu migrieren. |

**Umstellungsreihenfolge für Nutzer:**
1. Secrets-Modul wird installiert
2. Leeres `secrets.yaml`-Template wird angelegt (`shared/settings/secrets.yaml`, initial `{}`)
3. Nutzer trägt Credentials wahlweise in `secrets.yaml` ODER `secrets.conf` ein
4. Beim nächsten Daemon-Start verwendet das Plugin die neuen Werte

### Komponenten, die NICHT auf `secrets.py` migrieren

| Komponente | Datei | Begründung |
|---|---|---|
| **Samba (lokaler Share)** | `installation/routines/setup_samba.sh` | System-Level-Dienst, nicht Python. Das Passwort wird von `smbpasswd` verwaltet und nur **während der Installation** gesetzt (interaktive Auswahl: default/random/custom). Kein Laufzeit-Zugriff nötig. |
| **SMB MediaProvider** | `src/jukebox/components/smb/` (geplant) | Nutzt `secrets.retrieve()` für Credentials zu externen SMB-Servern. Die Migration ist im SMB-Plugin-Plan (`06-smb-plugin.md`) dokumentiert — dort wird die `gio mount`-Credential-Übergabe validiert. |

---

## WebUI / RPC-Anbindung (späterer Schritt)

**Prinzip:** WebUI darf Secrets **schreiben aber nicht lesen**.

| RPC Endpoint | Zugriff | Beschreibung |
|---|---|---|
| `secrets.store` | Write | Speichert ein Secret (überschreibt existierende) |
| `secrets.delete` | Write | Löscht ein Secret |
| `secrets.list_keys` | Read | Gibt Key-Namen zurück (KEINE Werte!) |
| `secrets.retrieve` | **Intern** | Nicht via RPC exponiert |

Nach einem `store`/`delete` über die WebUI muss der Daemon neu gestartet werden, damit die Plugins die neuen Credentials laden. Dies kann via RPC-Befehl an `hostif.linux` erfolgen:

```
# Workflow WebUI:
1. secrets.store('jellyfin', 'api_key', 'new_key')
2. hostif.linux.restart_service('jukebox-daemon')
```

> **Hinweis:** Die RPC-Exponierung ist als Folgeschritt gedacht und nicht Teil dieser initialen Implementierung. Das Secrets-Modul selbst ist RPC-agnostisch — die RPC-Wrapper können in einem separaten Schritt hinzugefügt werden.

---

## Neue Dateien

### `src/jukebox/jukebox/secrets.py`

(Bereits oben vollständig dokumentiert.)

### `test/secrets/__init__.py`

Leere Datei (Python package).

### `test/secrets/test_secrets.py`

```python
"""
Tests für das jukebox.secrets Modul.

Testet Store/Retrieve/Delete/List_keys mit
Prioritätskette Environment > secrets.yaml > Default.

Verwendet Key-Existence-Checks für secrets.yaml:
leere Strings, 0, False werden als gültige Werte behandelt und
fallen NICHT an den nächsten Prioritätslevel durch.

Für Umgebungsvariablen: muss existieren UND nicht-leer sein.
"""

import os
import pytest
import tempfile
from pathlib import Path
from unittest.mock import patch

import jukebox.secrets as secrets


class TestSecretsModule:
    """Integration tests for the secrets module."""

    @pytest.fixture(autouse=True)
    def setup_teardown(self):
        """Use a temp file as secrets.yaml for each test."""
        self.tmp = tempfile.NamedTemporaryFile(suffix='.yaml', delete=False)
        self.tmp.close()
        self.orig_path = secrets._SECRETS_YAML_PATH
        secrets._SECRETS_YAML_PATH = Path(self.tmp.name)
        secrets._reload_cache()
        yield
        secrets._SECRETS_YAML_PATH = self.orig_path
        secrets._reload_cache()
        os.unlink(self.tmp.name)

    # ---- store / retrieve round-trip ----

    def test_store_and_retrieve(self):
        secrets.store('mqtt', 'password', 'abc123')
        assert secrets.retrieve('mqtt', 'password') == 'abc123'

    def test_store_multiple_namespaces(self):
        secrets.store('mqtt', 'password', 'p1')
        secrets.store('jellyfin', 'api_key', 'k1')
        assert secrets.retrieve('mqtt', 'password') == 'p1'
        assert secrets.retrieve('jellyfin', 'api_key') == 'k1'

    def test_store_overwrites_existing(self):
        secrets.store('mqtt', 'password', 'old')
        secrets.store('mqtt', 'password', 'new')
        assert secrets.retrieve('mqtt', 'password') == 'new'

    # ---- retrieve with env-var override ----

    def test_retrieve_env_wins_over_stored(self):
        secrets.store('mqtt', 'password', 'stored_value')
        with patch.dict(os.environ, {'MQTT_PASSWORD': 'env_value'}):
            result = secrets.retrieve('mqtt', 'password', env_var='MQTT_PASSWORD')
            assert result == 'env_value'

    def test_retrieve_falls_back_to_yaml_when_no_env(self):
        secrets.store('mqtt', 'password', 'yaml_value')
        with patch.dict(os.environ, {}, clear=True):
            result = secrets.retrieve('mqtt', 'password', env_var='MQTT_PASS')
            assert result == 'yaml_value'

    def test_retrieve_default_when_nothing_set(self):
        with patch.dict(os.environ, {}, clear=True):
            result = secrets.retrieve('mqtt', 'password', default='fallback')
            assert result == 'fallback'

    def test_retrieve_none_when_nothing_and_no_default(self):
        with patch.dict(os.environ, {}, clear=True):
            result = secrets.retrieve('mqtt', 'password')
            assert result is None

    # ---- env var behavior: empty env = unset ----

    def test_empty_env_treated_as_unset(self):
        secrets.store('mqtt', 'password', 'yaml_value')
        with patch.dict(os.environ, {'MQTT_PASSWORD': ''}):
            result = secrets.retrieve('mqtt', 'password', env_var='MQTT_PASSWORD')
            assert result == 'yaml_value'

    # ---- key-existence semantics: falsy values are valid ----

    def test_falsy_stored_value_not_ignored(self):
        """Empty string is a valid stored secret, not treated as unset."""
        secrets.store('mqtt', 'password', '')
        with patch.dict(os.environ, {}, clear=True):
            result = secrets.retrieve('mqtt', 'password', default='fallback')
            assert result == ''

    def test_numeric_zero_stored_value_not_ignored(self):
        secrets.store('mqtt', 'port', 0)
        with patch.dict(os.environ, {}, clear=True):
            result = secrets.retrieve('mqtt', 'port', default=1883)
            assert result == 0

    def test_boolean_false_stored_value_not_ignored(self):
        secrets.store('mqtt', 'enabled', False)
        with patch.dict(os.environ, {}, clear=True):
            result = secrets.retrieve('mqtt', 'enabled', default=True)
            assert result is False

    # ---- delete ----

    def test_delete_existing_key(self):
        secrets.store('mqtt', 'password', 'abc')
        assert secrets.delete('mqtt', 'password') is True
        assert secrets.retrieve('mqtt', 'password') is None

    def test_delete_nonexistent_key(self):
        assert secrets.delete('mqtt', 'nonexistent') is False

    def test_delete_removes_empty_namespace(self):
        secrets.store('mqtt', 'password', 'abc')
        secrets.delete('mqtt', 'password')
        assert secrets.list_keys('mqtt') == []

    # ---- list_keys ----

    def test_list_keys_returns_only_names(self):
        secrets.store('mqtt', 'username', 'user1')
        secrets.store('mqtt', 'password', 'secret123')
        keys = secrets.list_keys('mqtt')
        assert keys == ['password', 'username']
        # Verify NO values are leaked
        assert 'user1' not in keys
        assert 'secret123' not in keys

    def test_list_keys_empty_namespace(self):
        assert secrets.list_keys('nonexistent') == []

    # ---- persistence across cache reload ----

    def test_data_survives_cache_reload(self):
        secrets.store('mqtt', 'password', 'persistent')
        secrets._reload_cache()
        assert secrets.retrieve('mqtt', 'password') == 'persistent'
```

---

## Datei-Übersicht (geänderte und neue Dateien)

| Datei | Art | Beschreibung |
|---|---|---|
| `src/jukebox/jukebox/secrets.py` | **Neu** | `store()`, `retrieve()`, `delete()`, `list_keys()` |
| `test/secrets/test_secrets.py` | **Neu** | pytest-Tests (17 Tests) |
| `test/secrets/__init__.py` | **Neu** | Leer (Python package) |
| `run_jukebox.sh` | Änderung | `source secrets.conf` vor Python-Start |
| `src/jukebox/components/mqtt/__init__.py` | Änderung | `retrieve()` für username/password |
| `installation/routines/setup_jukebox_core.sh` | Änderung | Leeres `secrets.yaml`-Template (`chmod 600`) erstellen; verify für `secrets.yaml` hinzufügen |
| `installation/routines/setup_samba.sh` | Änderung | Interaktive Samba-Passwort-Auswahl (default/random/custom); `force user` für `chmod 600`-Kompatibilität |

> **Kein `.gitignore`-Entry nötig:** `shared/settings/*` ignoriert bereits alle Dateien unter `shared/settings/`, einschließlich `secrets.yaml` und `secrets.conf`.

---

## Was NICHT in diesem Plan enthalten ist

| Thema | Begründung |
|---|---|
| RPC/WebSocket-Authentifizierung | Eigenes, größeres Thema |
| GVFS-Keyring | Nur mit Kiosk-Mode/D-Bus möglich |
| Hardware-bound Encryption (TPM/CPU-Serial) | Zu komplex für initiale Verbesserung |
| `.env`-Datei + `python-dotenv` | Zusätzliche Dependency nicht nötig |
| Verschlüsselte Secrets auf Disk | Overkill für Headless-Kiosk-Gerät |
| SMB `gio mount` Credential-Handling | Wird im SMB-Plugin-Plan validiert |
| RPC-Endpunkte für `secrets.*` | Folgeschritt — Secrets-Modul ist RPC-agnostisch designed |
| Automatischer Daemon-Restart nach Secret-Update | Folgeschritt — Caller (WebUI-Plugin) triggert Restart via `hostif` |
| Installer-zu-Python-Secrets-Bridge | Installer erstellt nur Template; Secrets werden via WebUI/RPC/nachträglich befüllt |
| Migrations-Automatisierung alter `jukebox.yaml`-Credentials | Keine In-Place-Upgrades; Nutzer migrieren manuell |