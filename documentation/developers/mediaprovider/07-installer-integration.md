# Milestone 7 — Generic Plugin Installation Process

## Ziel

Einen **generischen, datengetriebenen Plugin-Installationsprozess** in den bestehenden Installer integrieren. Dieser Prozess ist **vollständig unabhängig** von der MediaProvider-Architektur und kann für jeden beliebigen Jukebox-Plugin-Typ verwendet werden.

Ein Plugin-Entwickler erstellt sein Plugin nach dem definierten "Plugin-Contract". Der Maintainer fügt einen Eintrag in der Plugin-Registry hinzu. Der Installer zeigt automatisch eine Auswahloption für jedes registrierte Plugin und führt die Installation durch — **ohne Code-Änderungen am Installer**.

## Abhängigkeiten

- Nur: bestehender Installer in `installation/`

**Dieser Meilenstein ist unabhängig** von den MediaProvider-Änderungen (Milestones 1-6). Die Plugin-Registry und der Plugin-Contract sind generisch. Konkrete Plugins (Jellyfin, SMB) folgen diesem Contract — siehe deren eigene Pläne.

**Abhängigkeitsrichtung:**
```
Generic Plugin Install Process (M7)  ←  unabhängig, nur Installer
    ↑
    │  (Plugin-Contract wird befolgt)
    │
Jellyfin Plugin (M4)  ←  benötigt auch M1-M3 (MediaProvider Interface)
SMB Plugin (M6)       ←  benötigt auch M1-M2 (MediaProvider Interface)
```

**Secrets-Infrastruktur im Installer:** Dieser Meilenstein umfasst auch die
Installer-seitigen Änderungen für das Secrets-Handling:
- `setup_jukebox_core.sh`: Erstellt leeres `secrets.yaml`-Template (`chmod 600`)
- `run_jukebox.sh`: Sourced `secrets.conf` vor dem Python-Start (Env-Bootstrap)

Die vollständige Spezifikation befindet sich in **[`00a-secrets-infrastructure.md`](00a-secrets-infrastructure.md)** —
Abschnitte "Installer: secrets.yaml-Template erstellen" und "Env-Bootstrap via run_jukebox.sh".

## Design: Plugin-Registry (datengetrieben)

Eine **Plugin-Registry-Datei** (`resources/default-settings/plugin_registry.yaml`) definiert alle verfügbaren Plugins. Der Installer liest diese Datei und generiert daraus:

1. Interaktive Y/n-Abfragen für jedes Plugin
2. Installationsschritte (Repository klonen, Abhängigkeiten installieren)
3. Config-Aktivierung (Eintrag in `modules.others`)

```
Plugin-Registry (YAML)
  │
  ├── Plugin 1: jellyfin
  │     ├── name, description (für die Abfrage)
  │     ├── repository (zum Klonen)
  │     └── ...
  │
  ├── Plugin 2: smb
  │     └── ...
  │
  └── Plugin N: ... (zukünftige Plugins, beliebiger Typ)
```

## Plugin-Contract

Jedes Plugin, das über den Installer installierbar sein soll, muss diesen Contract erfüllen:

### 1. Repository-Struktur

Das Plugin-Repository wird via `git clone <url> ${INSTALLATION_PATH}/src/jukebox/components/{plugin_name}/` geklont. **Der Repo-Root IST direkt der Plugin-Inhalt** — ohne zusätzliche `src/jukebox/components/`-Verschachtelung:

```
plugin-repo/                       ← Repo-Root = Plugin-Root
├── __init__.py                    # Plugin-Code (mit @plugs.initialize etc.)
├── ... (plugin-spezifisch)        # Z.B. *_provider.py, api_client.py, ...
├── requirements.txt               # (optional) pip-Abhängigkeiten
├── install_dependencies.sh        # (optional) System-Abhängigkeiten
├── configure.sh                   # (optional) Post-Install-Konfiguration
├── config_schema.yaml             # (optional) WebUI-Konfigurationsschema
└── README.md
```

**Begründung:** Der Installer klont direkt nach `src/jukebox/components/{name}/`. Eine zusätzliche `src/jukebox/components/`-Verschachtelung im Repo würde zu doppelt genesteten Pfaden führen und das Plugin wäre nicht via `plugs.load()` erreichbar.

### 2. `install_dependencies.sh` (optional)

Falls das Plugin System-Abhängigkeiten benötigt (apt-Pakete), muss es ein ausführbares Skript `install_dependencies.sh` im Plugin-Root bereitstellen. Der Installer führt es mit `bash` aus.

Das Skript muss:
- Idempotent sein (mehrfache Ausführung ist sicher)
- Prüfen, ob Abhängigkeiten bereits installiert sind
- Klare Statusmeldungen ausgeben
- Bei Fehlern mit nicht-null exit code terminieren

### 3. `requirements.txt` (optional)

Falls das Plugin pip-Abhängigkeiten hat, die nicht in der Core-`requirements.txt` enthalten sind. Der Installer führt `pip install -r` aus.

### 4. `configure.sh` — Post-Install-Konfiguration (optional)

Falls das Plugin nach der Installation konfiguriert werden muss (z.B. Server-Adresse,
API-Key, Mount-Pfade), stellt es ein interaktives Skript `configure.sh` im Plugin-Root
bereit. Der Installer führt dieses Skript **nach** der erfolgreichen Installation und
**vor** dem Neustart der Jukebox aus.

**Contract für `configure.sh`:**

1. **Interaktivität:** Das Skript fragt den Benutzer nach den benötigten Konfigurations-
   werten (z.B. `read -r server_url`, `read -r api_key`)
2. **Ziel:** Schreibt die Werte direkt in `${SETTINGS_PATH}/jukebox.yaml` unter dem
   top-level Config-Key des Plugins (z.B. `jellyfin.host`, `smb.server`)
3. **Konfigurations-Key (config_key):** Wird aus der Plugin-Registry bezogen und als
   erstes Argument übergeben: `bash configure.sh <config_key>`
   - `config_key` ist der top-level YAML-Key in `jukebox.yaml` (z.B. `jellyfin`, `smb`)
   - Das Skript ist verantwortlich, darunter die benötigten Unter-Schlüssel anzulegen
4. **Validierung:** Muss Benutzereingaben validieren und bei ungültigen Werten erneut
   fragen oder mit einem nicht-null exit code abbrechen
5. **Hilfreiche Prompts:** Soll erklären, woher der Benutzer die benötigten Werte
   bekommt (z.B. "Jellyfin: Dashboard → API Keys → Create")
6. **Vorausgefüllte Defaults:** Falls vorkonfigurierte Werte aus der Registry vorhanden
   sind (siehe `config_defaults`), diese als Defaults anzeigen und bei leerer Eingabe
   verwenden

**Beispiel für Jellyfin (two-file write: non-sensitive → jukebox.yaml, sensitive → secrets.yaml):**
```bash
#!/usr/bin/env bash
# configure.sh — Post-Install configuration for Jellyfin MediaProvider
# Usage: bash configure.sh <config_key>

CONFIG_KEY="$1"
CONFIG_FILE="${SETTINGS_PATH}/jukebox.yaml"
SECRETS_FILE="${SETTINGS_PATH}/secrets.yaml"

echo "=== Jellyfin Configuration ==="
echo "You need a Jellyfin server and an API key."
echo "To get an API key: Jellyfin Dashboard → API Keys → Create"
echo ""

read -r -p "Jellyfin server URL (e.g. http://jellyfin.local:8096): " JELLYFIN_HOST
if [[ -z "$JELLYFIN_HOST" ]]; then
    echo "ERROR: Server URL is required."
    exit 1
fi

read -r -p "Jellyfin API key: " JELLYFIN_API_KEY
if [[ -z "$JELLYFIN_API_KEY" ]]; then
    echo "ERROR: API key is required."
    exit 1
fi

# Write non-sensitive config (host) to jukebox.yaml
"$VIRTUAL_ENV/bin/python3" -c "
from ruamel.yaml import YAML
yaml = YAML()
yaml.preserve_quotes = True
with open('${CONFIG_FILE}', 'r') as f:
    data = yaml.load(f)
data['${CONFIG_KEY}'] = {'host': '${JELLYFIN_HOST}'}
with open('${CONFIG_FILE}', 'w') as f:
    yaml.dump(data, f)
"

# Write sensitive values (api_key) to secrets.yaml (chmod 600)
"$VIRTUAL_ENV/bin/python3" -c "
from ruamel.yaml import YAML
yaml = YAML()
yaml.preserve_quotes = True
with open('${SECRETS_FILE}', 'r') as f:
    data = yaml.load(f) or {}
if '${CONFIG_KEY}' not in data:
    data['${CONFIG_KEY}'] = {}
data['${CONFIG_KEY}']['api_key'] = '${JELLYFIN_API_KEY}'
with open('${SECRETS_FILE}', 'w') as f:
    yaml.dump(data, f)
"
echo "Jellyfin configuration: non-sensitive keys written to jukebox.yaml, sensitive keys to secrets.yaml"
```

### 5. `config_schema.yaml` — Structured Configuration Schema (optional)

Falls das Plugin eigene Konfiguration hat, die über das WebUI bearbeitbar sein soll,
stellt es eine **YAML-Schema-Datei** `config_schema.yaml` im Plugin-Root bereit. Diese
Datei definiert alle Konfigurations-Schlüssel, ihre Typen, Beschreibungen, Defaults
und Validierungsregeln in einem strukturierten, maschinenlesbaren Format.

**Warum YAML-Schema (nicht JSON Schema)?**
- Das Projekt verwendet bereits `ruamel.yaml` für alle Konfigurationsdateien — **keine
  neue Abhängigkeit** nötig
- YAML ist für Entwickler lesbarer und kompakter als JSON Schema
- Die Schema-Datei wird vom Core via `ruamel.yaml` geparst und über RPC an das WebUI
  ausgeliefert (`misc.get_plugin_schemas()`)
- Das WebUI kann damit **dynamisch** Konfigurationsformulare rendern — ohne für jedes
  Plugin eigene UI-Komponenten zu schreiben

**Schema-Struktur:**

```yaml
# config_schema.yaml — Jellyfin MediaProvider Configuration Schema
# Dieses Schema definiert alle Konfigurations-Schlüssel, die das WebUI
# im Bereich "Settings → Plugins → Jellyfin" als Formular rendert.

config_key: jellyfin          # Top-level YAML-Key in jukebox.yaml
display_name: "Jellyfin Media Server"
description: >
  Configure your Jellyfin media server connection. You need a running
  Jellyfin server (10.8.x+) and an API key from the dashboard.

fields:
  - key: host
    type: string
    label: "Server URL"
    description: "Full URL to your Jellyfin server (e.g. http://jellyfin.local:8096)"
    default: ""
    required: true
    placeholder: "http://jellyfin.local:8096"
    validation:
      pattern: "^https?://.*"
      message: "Must be a valid HTTP(S) URL"

  - key: api_key
    type: string
    label: "API Key"
    description: "Create in Jellyfin Dashboard → API Keys"
    default: ""
    required: true
    sensitive: true         # WebUI zeigt ⬤⬤⬤ statt Klartext, verwendet Password-Feld
    env_var: JELLYFIN_API_KEY  # Wird alternativ aus Umgebungsvariable geladen

  - key: cache_dir
    type: string
    label: "Cache Directory"
    description: "Directory for cached cover art and metadata"
    default: "~/RPi-Jukebox-RFID/shared/artifacts/jellyfin_cache"
    required: false
```

**Feld-Typen:**

| `type` | WebUI-Widget | Beispiel |
|---|---|---|
| `string` | Textfeld | `host`, `api_key` |
| `number` | Number-Input | `port`, `timeout` |
| `boolean` | Checkbox / Switch | `enabled`, `use_ssl` |
| `integer` | Number-Input (Ganzzahlen) | `max_items`, `retry_count` |
| `select` | Dropdown | Siehe `options` |

**Feld-Attribute:**

| Attribut | Pflicht | Beschreibung |
|---|---|---|
| `key` | Ja | Konfigurations-Schlüssel (z.B. `host`) |
| `type` | Ja | Datentyp: `string`, `number`, `boolean`, `integer`, `select` |
| `label` | Ja | Anzeigename im WebUI-Formular |
| `description` | Nein | Hilfetext / Tooltip |
| `default` | Nein | Default-Wert |
| `required` | Nein | Pflichtfeld? (Default: `false`) |
| `placeholder` | Nein | Platzhalter-Text im Eingabefeld |
| `sensitive` | Nein | Secret? WebUI verwendet Password-Feld und zeigt nie Klartext (Default: `false`) |
| `env_var` | Nein | Name der Umgebungsvariable als alternative Quelle (siehe `secrets.conf`) |
| `validation` | Nein | Regex-Pattern + Fehlermeldung für Client-seitige Validierung |
| `options` | Nur bei `select` | Liste von `{value, label}`-Objekten |

**Beispiel für `select`-Typ:**
```yaml
  - key: second_swipe_action
    type: select
    label: "Second Swipe Action"
    description: "What happens when the same card is swiped twice"
    default: "toggle"
    options:
      - value: "toggle"
        label: "Toggle Play/Pause"
      - value: "play"
        label: "Play"
      - value: "skip"
        label: "Skip to Next"
      - value: "rewind"
        label: "Rewind"
      - value: "none"
        label: "Do Nothing"
```

### 6. RPC-Endpunkt `misc.get_plugin_schemas()`

Damit das WebUI die Schema-Dateien aller geladenen Plugins abrufen kann, wird
eine neue RPC-Funktion im `misc`-Package registriert:

```python
@plugin.register
def get_plugin_schemas():
    """
    Return config schemas from all loaded plugins.
    
    Scans each plugin directory for config_schema.yaml and parses it.
    Returns a dict keyed by plugin name.
    """
    schemas = {}
    for package_name, pkg_info in plugin.get_all_loaded_packages().items():
        plugin_dir = pkg_info.loaded_from  # e.g., "components.jellyfin"
        schema_file = os.path.join(
            os.path.dirname(sys.modules[plugin_dir].__file__),
            'config_schema.yaml'
        )
        if os.path.isfile(schema_file):
            yaml = YAML()
            with open(schema_file, 'r') as f:
                schemas[package_name] = yaml.load(f)
    return schemas
```

### 7. Eintrag in der Plugin-Registry

Der Maintainer fügt einen Eintrag in `resources/default-settings/plugin_registry.yaml` hinzu.

## Plugin-Registry: `resources/default-settings/plugin_registry.yaml`

```yaml
# =============================================================================
# Jukebox Plugin Registry
# =============================================================================
# Diese Datei definiert alle Plugins, die während der Installation
# zur Auswahl stehen.
#
# Um ein neues Plugin hinzuzufügen, füge einen Eintrag unter 'plugins' hinzu:
#
# plugins:
#   - name: mein_plugin                   # Eindeutiger Name (= modules.others Eintrag)
#     description: "Meine Beschreibung"   # Wird in der Installer-Abfrage angezeigt
#     repository: "https://github.com/..." # Git-Repository-URL
#     config_key: mein_plugin             # (optional) top-level Config-Key
#
# =============================================================================

plugins:
  - name: jellyfin
    description: "Stream music from a Jellyfin media server (REST API)"
    repository: "https://github.com/weo-soft/phoniebox-plugin-jellyfin"
    config_key: jellyfin

  - name: smb
    description: "Access music from a network share - NAS, Windows Share (GVFS/GIO)"
    repository: "https://github.com/weo-soft/phoniebox-plugin-smb"
    config_key: smb
```

**Feld-Beschreibung:**

| Feld | Pflicht | Beschreibung |
|---|---|---|
| `name` | Ja | Eindeutiger Plugin-Name. Entspricht dem Eintrag in `modules.others`. |
| `description` | Ja | Beschreibungstext für die interaktive Installer-Abfrage. |
| `repository` | Ja | Git-URL des Plugin-Repositories. |
| `config_key` | Nein | Top-level Config-Key in `jukebox.yaml`. Falls nicht angegeben, wird `name` verwendet. |

## Dateien

### Neu: `resources/default-settings/plugin_registry.yaml`

Siehe oben (Plugin-Registry-Datei).

### Neu: `installation/routines/setup_plugins.sh`

```bash
#!/usr/bin/env bash

# ---------------------------------------------------------------------------
# Generische, datengetriebene Plugin-Setup-Routine
#
# Liest die Plugin-Registry aus resources/default-settings/plugin_registry.yaml
# und installiert alle Plugins, für die der User sich entschieden hat.
#
# Diese Routine ist TYP-AGNOSTISCH — sie behandelt jedes Plugin gleich,
# unabhängig davon ob es ein MediaProvider, RFID-Reader, o.ä. ist.
# ---------------------------------------------------------------------------

PLUGIN_REGISTRY="${INSTALLATION_PATH}/resources/default-settings/plugin_registry.yaml"

# Wird in customize_options.sh gesetzt und von _option_plugins() befüllt
SELECTED_PLUGINS=""
# Custom/user-provided plugins: Format "name|repo_url", space-separated
CUSTOM_PLUGINS=""

# ---------------------------------------------------------------------------
# EINZELNE PLUGIN-INSTALLATION
# ---------------------------------------------------------------------------

_setup_single_plugin() {
    local plugin_name="$1"
    local plugin_repo="$2"
    local plugin_dir="${INSTALLATION_PATH}/src/jukebox/components/${plugin_name}"

    log "  Installing plugin: ${plugin_name}"

    # 1) Plugin-Repository klonen
    if [[ ! -d "$plugin_dir" ]]; then
        print_c "    Cloning ${plugin_name} from ${plugin_repo}..."
        git clone "$plugin_repo" "$plugin_dir" || {
            print_c "    WARNING: Failed to clone ${plugin_name} from ${plugin_repo}"
            return 1
        }
    else
        log "    Plugin directory already exists: ${plugin_dir}. Skipping clone."
    fi

    # 2) Plugin-eigene Dependencies installieren (falls vorhanden)
    local deps_script="${plugin_dir}/install_dependencies.sh"
    if [[ -f "$deps_script" ]]; then
        print_c "    Running plugin dependency installer..."
        bash "$deps_script" || {
            print_c "    WARNING: Dependency installation for ${plugin_name} failed."
        }
    fi

    # 3) Plugin-eigene pip requirements installieren (falls vorhanden)
    local pip_reqs="${plugin_dir}/requirements.txt"
    if [[ -f "$pip_reqs" ]]; then
        print_c "    Installing Python dependencies for ${plugin_name}..."
        source "${VIRTUAL_ENV}/bin/activate"
        pip install --no-cache-dir -r "$pip_reqs" || {
            print_c "    WARNING: pip install failed for ${plugin_name}."
        }
    fi

    # 4) Post-Install-Konfiguration ausführen (falls vorhanden)
    local configure_script="${plugin_dir}/configure.sh"
    if [[ -f "$configure_script" ]]; then
        print_c "    Running post-install configuration for ${plugin_name}..."
        bash "$configure_script" "$plugin_name" || {
            print_c "    WARNING: Configuration for ${plugin_name} failed."
            print_c "    You can re-run it later: bash ${configure_script}"
        }
    fi
}

# ---------------------------------------------------------------------------
# CONFIG-AKTIVIERUNG: Plugin-Namen in modules.others eintragen
# ---------------------------------------------------------------------------

_enable_plugins_in_config() {
    local config_file="${SETTINGS_PATH}/jukebox.yaml"

    if [[ -z "$SELECTED_PLUGINS" ]]; then
        log "No plugins selected. Skipping config."
        return
    fi

    print_c "  Enabling plugins in jukebox.yaml modules.others:"

    "$VIRTUAL_ENV/bin/python3" -c "
from ruamel.yaml import YAML
yaml = YAML()
yaml.preserve_quotes = True

selected = '${SELECTED_PLUGINS}'.split()
if not selected:
    exit(0)

with open('${config_file}', 'r') as f:
    data = yaml.load(f)

if 'modules' not in data:
    data['modules'] = {}
if 'others' not in data['modules']:
    data['modules']['others'] = []

others = data['modules']['others']

for plugin in selected:
    if plugin not in others:
        others.append(plugin)
        print(f'    \u2192 {plugin}')

with open('${config_file}', 'w') as f:
    yaml.dump(data, f)
" || {
        print_c "  WARNING: Failed to update modules.others."
    }
}

# ---------------------------------------------------------------------------
# HAUPT-ROUTINE
# ---------------------------------------------------------------------------

_run_setup_plugins() {
    local registry_file="$PLUGIN_REGISTRY"

    if [[ ! -f "$registry_file" ]]; then
        log "Plugin registry not found: ${registry_file}. Skipping."
        return
    fi

    for selected in $SELECTED_PLUGINS; do
        local repo_url
        repo_url=$("$VIRTUAL_ENV/bin/python3" -c "
from ruamel.yaml import YAML
yaml = YAML()
with open('${registry_file}', 'r') as f:
    data = yaml.load(f)
for p in data.get('plugins', []):
    if p.get('name') == '${selected}':
        print(p.get('repository', ''))
        break
")
        if [[ -z "$repo_url" ]]; then
            print_c "  WARNING: No repository URL for '${selected}'. Skipping."
            continue
        fi

        _setup_single_plugin "$selected" "$repo_url"
    done

    # Custom/user-provided plugins (keine Registry-Auflösung nötig)
    for custom_entry in $CUSTOM_PLUGINS; do
        local custom_name="${custom_entry%%|*}"
        local custom_repo="${custom_entry##*|}"
        if [[ -n "$custom_name" && -n "$custom_repo" ]]; then
            _setup_single_plugin "$custom_name" "$custom_repo"
            # Custom plugin names ebenfalls zu SELECTED_PLUGINS hinzufügen für config
            if [[ -z "$SELECTED_PLUGINS" ]]; then
                SELECTED_PLUGINS="$custom_name"
            else
                SELECTED_PLUGINS="$SELECTED_PLUGINS $custom_name"
            fi
        fi
    done

    _enable_plugins_in_config
}

setup_plugins() {
    if [[ -n "$SELECTED_PLUGINS" || -n "$CUSTOM_PLUGINS" ]]; then
        run_with_log_frame _run_setup_plugins "Install Plugins"
    else
        log "No plugins selected. Skipping."
    fi
}
```

### Geändert: `installation/routines/customize_options.sh`

Neue Funktion `_option_plugins` und Eintrag in `_run_customize_options`.

**Wichtig:** Die Plugin-Auswahl (y/n) erfolgt **nach `setup_jukebox_core()`**, daher sind
das venv und `ruamel.yaml` bereits verfügbar. `_option_plugins()` verwendet direkt
`plugin_registry.yaml` via Python — **kein separates `plugin_list.txt` nötig**.

```bash
_option_plugins() {
  local registry_file="${INSTALLATION_PATH}/resources/default-settings/plugin_registry.yaml"

  if [[ ! -f "$registry_file" ]]; then
    log "Plugin registry not found. Skipping plugin selection."
    return
  fi

  clear_c
  print_c "----------------------- PLUGINS -------------------------
The following optional plugins are available.
You will be asked for each one individually."

  # Read plugin entries from plugin_registry.yaml using ruamel.yaml
  local plugin_entries
  plugin_entries=$("$VIRTUAL_ENV/bin/python3" -c "
from ruamel.yaml import YAML
yaml = YAML()
with open('${registry_file}', 'r') as f:
    data = yaml.load(f)
for p in data.get('plugins', []):
    print(f\"{p['name']}|{p['description']}\")
")

  while IFS='|' read -r plugin_name plugin_desc; do
    [[ -z "$plugin_name" ]] && continue

    print_c "
----------------------------------------------------------
${plugin_name}:
  ${plugin_desc}

Do you want to install ${plugin_name}? [y/N]"
    read -r response
    case "$response" in
      [yY][eE][sS]|[yY])
        if [[ -z "$SELECTED_PLUGINS" ]]; then
          SELECTED_PLUGINS="$plugin_name"
        else
          SELECTED_PLUGINS="$SELECTED_PLUGINS $plugin_name"
        fi
        ;;
      *)
        ;;
    esac
  done <<< "$plugin_entries"

  log "SELECTED_PLUGINS=${SELECTED_PLUGINS}"

  # === Custom/User-provided Plugins ===
  print_c "
----------------------------------------------------------
Do you want to install any other (custom) plugins?
These are plugins NOT from the official registry.
You install them at your own risk. [y/N]"
  read -r response
  case "$response" in
    [yY][eE][sS]|[yY])
      while true; do
        print_c "
Enter plugin name (or leave empty to finish):"
        read -r custom_name
        if [[ -z "$custom_name" ]]; then
          break
        fi
        print_c "Enter Git repository URL for '${custom_name}':"
        read -r custom_repo
        if [[ -z "$custom_repo" ]]; then
          print_c "  WARNING: No repository URL provided. Skipping."
          continue
        fi
        if [[ -z "$CUSTOM_PLUGINS" ]]; then
          CUSTOM_PLUGINS="${custom_name}|${custom_repo}"
        else
          CUSTOM_PLUGINS="${CUSTOM_PLUGINS} ${custom_name}|${custom_repo}"
        fi
        print_c "  Added: ${custom_name} from ${custom_repo}"
      done
      ;;
    *)
      ;;
  esac

  log "CUSTOM_PLUGINS=${CUSTOM_PLUGINS}"
}
```

In `_run_customize_options` hinzufügen:

```bash
  _option_plugins              # ← NEU
```

### Geändert: `installation/routines/install.sh` — Sequenzierung

Plugin-Auswahl und Installation finden beide **nach** `setup_jukebox_core` statt,
da das venv und `ruamel.yaml` benötigt werden:

```bash
install() {
  ...
  setup_jukebox_core
  customize_options              # ← _option_plugins() läuft jetzt NACH venv-Setup
  setup_plugins                  # ← Installation (git clone, pip, enable)
  ...
}
```

### Geändert: `installation/includes/01_default_config.sh`

```bash
SELECTED_PLUGINS=${SELECTED_PLUGINS:-""}
CUSTOM_PLUGINS=${CUSTOM_PLUGINS:-""}
```

## Datenfluss

```
install-jukebox.sh
  ├── setup_jukebox_core()     # ← venv & ruamel.yaml verfügbar
  │
  ├── customize_options()
  │     └── _option_plugins()  # ← NACH venv: parst plugin_registry.yaml via ruamel.yaml
  │           ├── Liest plugin_registry.yaml
  │           ├── Für jeden Eintrag: Zeige Name + Beschreibung
  │           ├── Fragt: "{name} installieren? [y/N]"
  │           └── Sammelt ausgewählte Namen in $SELECTED_PLUGINS
  │
  └── setup_plugins()
        ├── Für jeden Eintrag in $SELECTED_PLUGINS:
        │     ├── Lese repository-URL aus Registry
        │     ├── git clone → src/jukebox/components/{name}/
        │     ├── bash install_dependencies.sh (falls vorhanden)
        │     └── pip install -r requirements.txt (falls vorhanden)
        │
        └── _enable_plugins_in_config()
              └── Fügt alle {name} zu modules.others in jukebox.yaml hinzu
```

## Workflow: Ein neues Plugin hinzufügen

### Für den Plugin-Entwickler

1. **Repository erstellen** — siehe "Plugin-Contract"
2. **Plugin-Code** implementieren (beliebiger Typ — MediaProvider, RFID-Reader, ...)
3. **`install_dependencies.sh`** und/oder `requirements.txt` bereitstellen, falls benötigt
4. **README.md** mit Installations- und Konfigurationsanleitung
5. **Plugin beim Maintainer einreichen**

### Für den Maintainer

1. Repository prüfen (Qualität, Sicherheit, Lizenz)
2. Eintrag zu `resources/default-settings/plugin_registry.yaml` hinzufügen
3. **Keine Code-Änderungen am Installer nötig**

## Konkrete Plugins, die diesen Contract befolgen

| Plugin | Meilenstein | Contract-Elemente |
|---|---|---|
| Jellyfin | [04-jellyfin-plugin.md](04-jellyfin-plugin.md) | Repo-Struktur, `requirements.txt` |
| SMB | [06-smb-plugin.md](06-smb-plugin.md) | Repo-Struktur, `install_dependencies.sh` |

Beide Plugin-Pläne dokumentieren in einer "Installer Contract Compliance"-Sektion, wie sie den Contract erfüllen.

## Tests

1. **Registry mit 2 Plugins, beide = yes** → beide geklont, beide in `modules.others`
2. **Registry mit 2 Plugins, eins = no** → nur eins geklont/aktiviert
3. **Registry mit 0 Plugins** → überspringt
4. **Registry fehlt** → überspringt (kein Fehler)
5. **Plugin-Repo nicht erreichbar** → Warning, Installation fortgesetzt
6. **`install_dependencies.sh` fehlt** → übersprungen (optional)

## Akzeptanzkriterien

- [ ] Plugin-Registry (`plugin_registry.yaml`) definiert alle verfügbaren Plugins
- [ ] `_option_plugins()` liest Registry und zeigt dynamisch eine Abfrage pro Plugin
- [ ] `setup_plugins()` klont jedes gewählte Plugin-Repo
- [ ] Plugin-eigene `install_dependencies.sh` wird ausgeführt (falls vorhanden)
- [ ] Plugin-eigene `requirements.txt` wird via pip installiert (falls vorhanden)
- [ ] Ausgewählte Plugins werden in `modules.others` in `jukebox.yaml` eingetragen
- [ ] Keine Code-Änderung am Installer nötig, um ein neues Plugin hinzuzufügen
- [ ] Fehler bei einzelner Plugin-Installation brechen nicht die gesamte Installation ab

## Plugin-Contract — Zusammenfassung

| Anforderung | Typ | Beschreibung |
|---|---|---|
| Repository-Struktur | Pflicht | `src/jukebox/components/{name}/` als Plugin-Root |
| `__init__.py` | Pflicht | Plugin-Code (Lifecycle, Registrierung) |
| `install_dependencies.sh` | Optional | System-Abhängigkeiten (apt) |
| `requirements.txt` | Optional | Python-Abhängigkeiten (pip) |
| `configure.sh` | Optional | Interaktive Post-Install-Konfiguration |
| `config_schema.yaml` | Optional | Strukturiertes Schema für WebUI-Konfigurationsformular |
| `README.md` | Empfohlen | Dokumentation & Konfigurationsanleitung |
| Registry-Eintrag | Pflicht | `name`, `description`, `repository` in `plugin_registry.yaml` |
