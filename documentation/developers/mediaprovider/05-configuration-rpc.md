# Milestone 5 — Core: Card Routing & Config

## Ziel

Karten-Routing über mehrere Provider hinweg ermöglichen, YAML-Konfiguration aktualisieren und RPC-Kompatibilität sicherstellen.

Dieser Milestone schließt die Integration ab.

## Abhängigkeiten

- Milestone 0 (Prerequisites — `PlayCardState` in `jukebox.callingback`)
- Milestone 2 (MPD-Adapter) — MPD als Default-Provider
- Mindestens ein externer Provider (Milestone 4 — Jellyfin) zum Testen des Routings
- **Kein separates CardRoutingPlugin** — Routing erfolgt über erweiterte `cards.yaml`-Einträge und `decode_card_command()` in `rfid/cardutils.py`

- **Vereinheitlichung von `decode_card_command()`** in `rfid/cardutils.py` — **alle** Playback-Karten (auch legacy alias-basierte MPD-Karten) werden transparent in das einheitliche `provider:`-Format konvertiert (siehe [cards-yaml-unification.md](cards-yaml-unification.md))
- **Config-Update** — `jukebox.default.yaml` um neue top-level Config-Keys für externe Provider erweitern
- **RPC-Erweiterung** — `misc.list_providers()` und `misc.get_default_provider()` in `misc.py`
- **Second-Swipe-Logik** — wird von der `MediaProvider`-Basisklasse geerbt (bereits in Milestone 1 implementiert) und von `PlayerMPD.play_card()` via Manager geteilt

## Design

### Problem

RFID-Karten müssen an verschiedene Provider geroutet werden können. Bisher gibt es nur den MPD-Pfad über `player.ctrl.play_card(folder)`. Mit mehreren Providern muss die Karte wissen, welcher Provider zuständig ist.

### Lösung: Vereinheitlichtes `cards.yaml` + `decode_card_command()`

**Adopted from [cards-yaml-unification.md](cards-yaml-unification.md):** Statt zwei paralleler
Formate (altes `alias:` und neues `provider:`) wird **ein einheitliches Format** für alle
Playback-Karten verwendet. Legacy-MPD-Karten (`alias: play_card` / `alias: play_folder`) werden
von `_resolve_provider()` transparent auto-detektiert und in das `provider: mpd`-Format konvertiert.

```
Karte aufgelegt → RFID reader → decode_card_command()
  │
  ├── _resolve_provider() — erkennt Playback-Karten (alle Provider, inkl. Legacy-MPD)
  │   ├── Explizites `provider:`-Feld? → provider, value, recursive
  │   ├── Legacy `alias: play_card`?  → provider=mpd, value=args[0]
  │   └── Weder noch?                 → None (keine Playback-Karte)
  │
  ├── Provider erkannt?
  │   ├── Ja → Generiere RPC: {provider}.provider.play_card(folder=value)
  │   │         → MediaProvider.play_card() (Basisklasse)
  │   │              → Second-Swipe-Prüfung anhand globaler last_played_folder
  │   │              → play_folder(value) (provider-spezifisch)
  │   │
  │   └── Nein → Alias-basierte Auflösung (nur für Command-Karten: shutdown, GPIO, etc.)
  │               → utils.decode_rpc_command() (wie bisher)
```

### Vorteile

- **Ein Code-Pfad für alle Playback-Karten** — keine provider/alias-Verzweigung in der main-Funktion
- **Keine Änderungen** am RFID-Reader (`rfid/reader/__init__.py`)
- **Keine Änderungen** an `rpc_command_alias.py`
- **Keine Änderungen** an `daemon.py`
- **Zero User-Migration** — Legacy-Karten (`alias: play_card`) werden auto-detektiert
- **Klar getrennt** — Playback-Karten (`provider:`) vs. Command-Karten (`alias:`)
- **Neue Karten** werden nur noch im `provider:`-Format geschrieben (WebUI, `register_card()`)

### Second-Swipe-Logik

Die Second-Swipe-Erkennung wird **nicht** in `decode_card_command()` implementiert, sondern in der `MediaProvider`-Basisklasse (Milestone 1). Da **alle** Playback-Karten über denselben Pfad `{provider}.provider.play_card(value)` geroutet werden, teilen sie sich automatisch denselben `_last_played_folder` im `MediaProviderManager`.

**Globaler `_last_played_folder`:** Wird im `MediaProviderManager` verwaltet (nicht pro Provider-Instanz) und über `music_player_status.json` persistiert. Da immer nur eine Karte "zuletzt" gespielt wurde, reicht ein globaler Wert. Ein zweiter Swipe mit gleichem folder-Wert wird **unabhängig vom Provider** als Second Swipe erkannt.

**Globale `second_swipe_action`:** Wird einmalig aus der `playermpd.second_swipe_action`-Config aufgelöst und vom Manager bereitgestellt (`get_manager().set_second_swipe_action(player_ctrl.second_swipe_action)`).

**Zentrale `play_card_callbacks`:** Werden in `playermpd/__init__.py` erstellt, via `set_play_card_callbacks()` in den Manager injiziert und für alle Provider genutzt.

**Wichtig:** Es wird nur **eine** globale `last_played_folder` gespeichert — nicht pro Provider. Dies ist korrekt, da immer nur eine Karte "zuletzt" gespielt wurde.

## Dateien

### Geändert: `src/jukebox/components/rfid/cardutils.py`

```python
"""
Common card decoding functions — unified provider-based routing.

ALL playback cards use the unified format:
    provider: <provider_name>
    value: <provider-opaque identifier>
    recursive: false  (optional)

Legacy alias-based MPD cards (alias: play_card, alias: play_folder)
are auto-detected and transparently converted to provider: mpd.

Command cards (shutdown, GPIO, etc.) still use the alias format.
See documentation/developers/mediaprovider/cards-yaml-unification.md
"""

import logging
from typing import (List, Mapping, Optional)
import jukebox.utils as utils
import jukebox.cfghandler

log = logging.getLogger('jb.cardutils')
cfg_cards = jukebox.cfghandler.get_handler('cards')


def _resolve_provider(cfg_rpc_cmd: Mapping, logger: logging.Logger):
    """
    Resolve provider, value, recursive from card config.

    Priority:
    1. Explicit provider: field → use directly
    2. Legacy alias: play_card / play_folder → auto-detect as provider=mpd
    3. Everything else → return (None, '', False, False) (not a playback card)

    :return: Tuple of (provider_name, value, recursive, is_legacy)
    """
    # 1. Explicit provider field
    if 'provider' in cfg_rpc_cmd:
        provider_name = cfg_rpc_cmd['provider']
        value = cfg_rpc_cmd.get('value', '')
        recursive = cfg_rpc_cmd.get('recursive', False)
        if not provider_name:
            logger.error("Card entry has 'provider:' field but no provider name")
            return (None, '', False, False)
        if not value:
            logger.error(f"Card entry for provider '{provider_name}' has no 'value' field")
            return (None, '', False, False)
        return (provider_name, value, recursive, False)

    # 2. Legacy MPD playback cards (auto-detect)
    alias = cfg_rpc_cmd.get('alias')
    if alias in ('play_card', 'play_folder'):
        args = cfg_rpc_cmd.get('args', [])
        value = args[0] if args else ''
        recursive = len(args) > 1 and args[1] is True
        logger.debug(
            f"Auto-detected legacy MPD card: alias={alias}, "
            f"value={value}, recursive={recursive}"
        )
        return ('mpd', value, recursive, True)

    # 3. Not a playback card (command, GPIO, etc.)
    return (None, '', False, False)


def decode_card_command(cfg_rpc_cmd: Mapping, logger: logging.Logger = log):
    """
    Decode a card command with unified provider-based routing.

    All playback cards (explicit provider: or legacy alias: play_card/play_folder)
    are routed through the single path: {provider}.provider.play_card(value).

    Command cards (shutdown, GPIO, etc.) fall through to alias-based routing.

    Unified format (recommended):
        rfid_card_01:
          provider: mpd
          value: "AlbumXYZ"

        rfid_card_02:
          provider: jellyfin
          value: "folder_id_456"

        rfid_card_03:
          provider: smb
          value: "music:/Rock/AlbumXYZ"
          recursive: true

    Legacy format (auto-detected, no migration needed):
        rfid_card_01:
          alias: play_card
          args: ["AlbumXYZ"]
    """
    if cfg_rpc_cmd is None:
        return None

    # Step 1: Resolve to provider format (with legacy auto-detection)
    provider_name, value, recursive, is_legacy = _resolve_provider(cfg_rpc_cmd, logger)

    if provider_name is not None:
        # Step 2: Validate provider availability
        try:
            from jukebox.mediaprovider import get_manager
            get_manager().resolve(provider_name)
        except (KeyError, RuntimeError) as e:
            logger.error(f"Provider '{provider_name}' not available: {e}")
            return None

        # Step 3: Build unified RPC action
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

    # Step 4: Fall through to alias-based routing (command cards only)
    action = utils.decode_rpc_command(cfg_rpc_cmd, logger)
    if 'ignore_same_id_delay' in cfg_rpc_cmd:
        action['ignore_same_id_delay'] = cfg_rpc_cmd['ignore_same_id_delay']
    if 'ignore_card_removal_action' in cfg_rpc_cmd:
        action['ignore_card_removal_action'] = cfg_rpc_cmd['ignore_card_removal_action']
    return action


def card_command_to_str(cfg_rpc_cmd: Mapping, long=False) -> List[str]:
    """Returns a list of strings with [card_action, ignore_same_id_delay, ignore_card_removal_action]

    The last two parameters are only present, if *long* is True and if they are present in the cfg_rpc_cmd"""
    action = decode_card_command(cfg_rpc_cmd)
    if action is None:
        return ["Error: Could not decode card command"]

    # Playback cards (unified or legacy) — format as provider.play_card
    provider_name, _, _, _ = _resolve_provider(cfg_rpc_cmd, log)
    if provider_name is not None:
        readable = [f"{provider_name}.provider.play_card('{cfg_rpc_cmd.get('value', cfg_rpc_cmd.get('args', [''])[0])}')"]
        if long:
            if 'ignore_same_id_delay' in action.keys():
                readable.append(f"ignore_same_id_delay: {action['ignore_same_id_delay']}")
            if 'ignore_card_removal_action' in action.keys():
                readable.append(f"ignore_card_removal_action: {action['ignore_card_removal_action']}")
        return readable

    # Command cards — existing format
    readable = [utils.rpc_call_to_str(action)]
    if long:
        if 'ignore_same_id_delay' in action.keys():
            readable.append(f"ignore_same_id_delay: {action['ignore_same_id_delay']}")
        if 'ignore_card_removal_action' in action.keys():
            readable.append(f"ignore_card_removal_action: {action['ignore_card_removal_action']}")
    return readable


def card_to_str(card_id: str, long=False) -> List[str]:
    """Returns a list of strings from card entry command in the format of :func:`card_command_to_str`"""
    readable = ["Error: Card ID not found in database!"]
    if card_id in cfg_cards:
        readable = card_command_to_str(cfg_cards.getn(card_id, default=None), long)
    return readable
```

### Geändert: `src/jukebox/components/misc/__init__.py` — neue Core RPC-Funktionen

Die RPC-Funktionen `list_providers()` und `get_default_provider()` werden in
`misc/__init__.py` registriert (nicht in `jukebox.mediaprovider`), da `misc` als
Plugin-Package über `load_all_unnamed` geladen wird und zum Zeitpunkt der
Registrierung bereits in `_PLUGINS` existiert. Ein `@plugs.register(package='misc')`
im Core-Paket `jukebox.mediaprovider` würde fehlschlagen, weil das Core-Paket via
`import jukebox.mediaprovider` in `daemon.py` vor dem Plugin-Loading geladen wird,
zu einem Zeitpunkt wo `misc` noch nicht in `_PLUGINS` ist.

```python
# In src/jukebox/components/misc/__init__.py (am Ende hinzufügen):
from jukebox.mediaprovider import get_manager


@plugs.register
def list_providers() -> list:
    """
    List all registered media providers.

    RPC: misc.list_providers
    """
    return get_manager().list_providers()


@plugs.register
def get_default_provider() -> str:
    """
    Get the name of the current default provider.

    RPC: misc.get_default_provider
    """
    return get_manager().get_default() or ''
```

> **Hinweis:** Die Registrierung erfolgt im `misc`-Package, das als reguläres Plugin
> via `load_all_unnamed` geladen wird. `jukebox.mediaprovider` (ein Core-Paket) wird
> zuvor via explizitem `import` in `daemon.py` geladen und stellt den `get_manager()`-
> Singleton bereit. Diese Struktur vermeidet die fehlerhafte `@plugs.register`-Dekorator-
> Auswertung gegen ein noch nicht geladenes Package.

### Keine Änderungen

| Datei | Begründung |
|---|---|
| `src/jukebox/jukebox/daemon.py` | Minor: expliziter `import jukebox.mediaprovider` vor Plugin-Loading |
| `src/jukebox/jukebox/plugs.py` | Keine Änderung — Plugin-Mechanismus bleibt identisch |
| `src/jukebox/components/rfid/reader/__init__.py` | Keine Änderung — `decode_card_command()` wird bereits aufgerufen |
| `src/jukebox/components/rpc_command_alias.py` | Keine Änderung — `player.ctrl.*` bleibt erhalten |
| `src/webapp/` | Keine Änderung — RPC-Schnittstelle wird erweitert, nicht geändert |

## Konfiguration

### Geändert: `resources/default-settings/jukebox.default.yaml`

Der bestehende `playermpd:` Block bleibt unverändert. Neue top-level Config-Keys für externe Provider werden hinzugefügt:

```yaml
# =============================================================================
# External MediaProvider Configuration
# =============================================================================
# Diese Provider sind optional und werden nur aktiv, wenn sie in modules.others
# gelistet sind. MPD ist immer der Default-Provider und das Audio-Backend.
#
# Secrets (API-Keys, Passwörter) werden NICHT mehr in dieser Datei gespeichert.
# Stattdessen werden sie aus Umgebungsvariablen geladen, die in
# shared/settings/secrets.conf definiert sind.
# Siehe documentation/develope00a-secrets-infrastructure.md

# === Core Infrastructure ===
secrets:
  # Path to the secrets yaml file (relative to src/jukebox/ CWD)
  file: ../../shared/settings/secrets.yaml

# Jellyfin Media Provider (optional)
jellyfin:
  host: ""
  # api_key wird aus der Umgebungsvariable JELLYFIN_API_KEY geladen
  # (optionaler Fallback: api_key direkt hier eintragen)
  api_key: ""

# SMB Media Provider (optional)
smb:
  # shares ist ein dict: share_name → {server, share, username?, password?}
  shares: {}
  # username und password werden aus Umgebungsvariablen geladen:
  # SMB_USERNAME, SMB_PASSWORD
  # (optionaler Fallback: direkt hier eintragen)
  username: guest
  password: ""
```

### Plugin-Konfiguration (`modules.others`)

Die Namen in `modules.others` werden **ohne** `components.`-Präfix angegeben (da `load_all_unnamed` bereits `prefix='components'` setzt):

```yaml
modules:
  named:
    player: playermpd    # MPD ist immer aktiv (Named Plugin)
    volume: volume
    # ... andere named plugins ...
  others:
    - misc
    - jellyfin           # ← OPTIONAL: Zum Aktivieren einkommentieren (NICHT 'components.jellyfin'!)
    - smb                # ← OPTIONAL: Zum Aktivieren einkommentieren (NICHT 'components.smb'!)
```

## cards.yaml — Vereinheitlichtes Format

**Siehe [cards-yaml-unification.md](cards-yaml-unification.md) für die vollständige Analyse.**

```yaml
# === Playback-Karten (alle Provider — einheitliches Format) ===

# MPD (lokale Dateien):
rfid_card_01:
  provider: "mpd"
  value: "AlbumXYZ"

rfid_card_01_recursive:
  provider: "mpd"
  value: "AlbumXYZ"
  recursive: true

# Jellyfin:
rfid_card_02:
  provider: "jellyfin"
  value: "folder_id_456"

# SMB (Multi-Share):
rfid_card_03:
  provider: "smb"
  value: "music:/Rock/AlbumXYZ"

# === Command-Karten (alias-basiert, unverändert) ===

rfid_card_shutdown:
  alias: host.shutdown

rfid_card_next:
  alias: player.ctrl.next
```

**Regeln:**
- **Playback-Karten** verwenden `provider:` + `value:` + optional `recursive:`
- **Command-Karten** (shutdown, GPIO, skip, etc.) verwenden `alias:`
- Legacy `alias: play_card` / `alias: play_folder` wird von `_resolve_provider()` auto-detektiert → `provider: mpd`
- Neue Karten werden vom WebUI und `register_card()` nur noch im `provider:`-Format geschrieben
- `ignore_same_id_delay` und `ignore_card_removal_action` werden in beiden Formaten unterstützt

## Aktivierung eines externen Plugins (Checkliste für Builder)

### Beispiel: Jellyfin-Plugin aktivieren

1. **Plugin installieren:**
   ```bash
   git clone https://github.com/.../jellyfin-plugin.git \
       src/jukebox/components/jellyfin/
   ```

2. **Abhängigkeiten installieren:**
   ```bash
   pip install -r src/jukebox/components/jellyfin/requirements.txt
   ```

3. **Config erstellen:**
   ```yaml
   # jukebox.yaml
   modules:
     others:
       - jellyfin   # ← Aktivieren (OHNE 'components.' Präfix!)
   
   jellyfin:
     host: http://dein-jellyfin-server:8096
     # api_key leer lassen — wird aus secrets.conf geladen
   ```

4. **Secrets-Datei anlegen** (`shared/settings/secrets.conf`, `chmod 600`):
   ```bash
   # secrets.conf
   JELLYFIN_API_KEY=dein-api-key
   ```

   Siehe [Secrets Handling](00a-secrets-infrastructure.md) für Details.

5. **Karten zuweisen:**
   ```yaml
   # cards.yaml
   rfid_card_01:
     provider: jellyfin
     value: "folder_id_456"
   ```

6. **Jukebox neustarten:**
   ```bash
   sudo systemctl restart jukebox-daemon.service
   ```

### Beispiel: SMB-Plugin aktivieren

1. **GVFS installieren (System-Abhängigkeit):**
   ```bash
   sudo apt-get install gvfs gvfs-fuse
   ```

2. **Plugin in `modules.others` aktivieren:**
   ```yaml
   modules:
     others:
       - smb   # ← Aktivieren (OHNE 'components.' Präfix!)
   
   smb:
     shares:
       music:
         server: "192.168.1.100"
         share: "music"
       audiobooks:
         server: "192.168.1.100"
         share: "audiobooks"
     # username und password werden aus secrets.conf geladen
   ```

3. **Secrets-Datei anlegen** (`shared/settings/secrets.conf`, `chmod 600`):
   ```bash
   # secrets.conf
   SMB_USERNAME=smb_user
   SMB_PASSWORD=smb_geheim
   ```

4. **Karten zuweisen:**
   ```yaml
   # cards.yaml
   rfid_card_music:
     provider: smb
     value: "music:/Rock/AlbumXYZ"
   
   rfid_card_audiobook:
     provider: smb
     value: "audiobooks:/Kapitel1"
   ```

## Auswirkungen auf bestehende Plugins

### `playermpd/__init__.py`

- `PlayerMPD.play_card()` liest `_last_played_folder` via `get_manager().get_last_played_folder()` (statt direkt aus `music_player_status` dict)
- `PlayerMPD.play_folder()` schreibt via `get_manager().set_last_played_folder(folder)`
- `play_card_callbacks` wird wie bisher erstellt, dann via `set_play_card_callbacks()` injiziert
- `PlayerMPD.get_current_song(self, param)` → `get_current_song(self)` (ungennutzter param entfernt)

### `rfid/reader` (RFID Plugin)

- **Keine Änderungen** — der Reader ruft weiterhin `decode_card_command()` auf und führt das resultierende RPC aus
- Provider-basierte Karten werden automatisch über die erweiterte `decode_card_command()` geroutet

### `rfid/cards` (Card Database Plugin)

- Keine Änderungen am Card-Registrierungsprozess
- `register_card()` kann in Zukunft um ein `provider`-Argument erweitert werden

## Tests

### Neu: `test/card_routing/test_card_routing.py`

- Test: `_resolve_provider()` mit `provider:`-Feld → (`provider`, `value`, `recursive`, `False`)
- Test: `_resolve_provider()` mit `alias: play_card` → (`'mpd'`, `args[0]`, `False`, `True`)
- Test: `_resolve_provider()` mit `alias: play_folder` + rekursiv → (`'mpd'`, `args[0]`, `True`, `True`)
- Test: `_resolve_provider()` mit `alias: host.shutdown` → (`None`, ...)
- Test: `decode_card_command()` mit `provider:` → `{provider}.provider.play_card(value)`
- Test: `decode_card_command()` mit legacy `alias: play_card` → `player.provider.play_card(value)`
- Test: `decode_card_command()` mit legacy `alias: play_card` + `ignore_same_id_delay`
- Test: `decode_card_command()` mit command card (`alias: host.shutdown`) → alias-basiert
- Test: `decode_card_command()` mit unbekanntem Provider → loggt Fehler, `None`
- Test: `decode_card_command()` mit fehlendem `value` → loggt Fehler, `None`
- Test: `card_command_to_str()` formatiert Playback-Karten als `{provider}.provider.play_card(...)`
- Test: `misc.list_providers()` zeigt alle registrierten Provider
- Test: `misc.get_default_provider()` gibt den Default-Namen zurück

## Akzeptanzkriterien

- [ ] `_resolve_provider()` erkennt explizite `provider:`-Karten
- [ ] `_resolve_provider()` auto-detektiert legacy `alias: play_card` → `provider=mpd`
- [ ] `_resolve_provider()` auto-detektiert legacy `alias: play_folder` → `provider=mpd`
- [ ] `_resolve_provider()` gibt `None` für command cards (`alias: host.shutdown`)
- [ ] `decode_card_command()` routet **alle** Playback-Karten über `{provider}.provider.play_card(value)`
- [ ] `decode_card_command()` routet command cards über `utils.decode_rpc_command()`
- [ ] Legacy-MPD-Karten funktionieren **ohne Änderungen** an `cards.yaml`
- [ ] `jukebox.default.yaml` enthält die neuen top-level Config-Keys für externe Provider
- [ ] Externe Provider sind in `modules.others` auskommentiert (opt-in, OHNE `components.`-Präfix)
- [ ] `misc.list_providers()` listet alle registrierten Provider
- [ ] `misc.get_default_provider()` gibt den Default-Namen zurück
- [ ] Bestehende `player.ctrl.*`-Aufrufe funktionieren weiterhin
- [ ] `PlayerMPD.get_current_song()` hat keinen `param`-Parameter mehr
- [ ] Second-Swipe-Logik wird von `MediaProvider`-Basisklasse geerbt (ein Pfad für alle Playback-Karten)
- [ ] `register_card()` schreibt neue Karten im `provider: mpd`-Format
- [ ] Kein separates `CardRoutingPlugin` nötig
