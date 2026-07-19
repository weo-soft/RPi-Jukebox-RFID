# MediaProvider & Plugin Architecture — Overview

## Ziel

Dieses Projekt verfolgt zwei zusammenhängende, aber technisch unabhängige Ziele:

### Ziel 1: Generischer Plugin-Installationsprozess

Einen **datengetriebenen Plugin-Installationsmechanismus** in den bestehenden Installer integrieren. Dieser erlaubt es, beliebige Jukebox-Plugins (nicht nur MediaProvider) über eine YAML-Registry zu registrieren. Der Installer klont automatisch das Plugin-Repository, installiert dessen Abhängigkeiten und aktiviert es in der Jukebox-Konfiguration — **ohne Code-Änderungen am Installer**.

→ Siehe [Milestone 7: Generic Plugin Installation Process](07-installer-integration.md)

### Ziel 2: MediaProvider-Abstraktionsschicht + Konkrete Plugins

Eine **`MediaProvider`-Abstraktionsschicht** einführen, die es ermöglicht, verschiedene Medienquellen (MPD, Jellyfin, SMB, Subsonic, Spotify etc.) einheitlich anzusprechen. Auf dieser Basis werden **konkrete Provider-Plugins** entwickelt (Jellyfin, SMB), die als unabhängige Plugins über den generischen Installationsprozess installiert werden können.

→ Siehe [Milestones 1-6](01-core-mediaprovider-interface.md)

### Voraussetzungen: Querschnittliche Infrastruktur (Milestone 0)

Eine querschnittliche Änderung wird von fast allen anderen Meilensteinen benötigt und sollte **vor** den MediaProvider-Meilensteinen implementiert werden:

- **Secrets-Infrastruktur** (`src/jukebox/jukebox/secrets.py`): `retrieve()`-Funktion, die Secrets bevorzugt aus Umgebungsvariablen (geladen aus `secrets.conf` via `run_jukebox.sh`) und mit Fallback auf YAML-Konfiguration liest. Wird von Jellyfin (M4) und SMB (M6) für API-Keys und Passwörter benötigt. Siehe [Secrets Handling](00a-secrets-infrastructure.md).

Die **PlayCardState-Extraktion** ist Teil von **Milestone 1 (MediaProvider Interface)**, da sie dort für den `MediaProviderManager` benötigt wird.

→ Siehe [Milestone 0: Prerequisites](00-prerequisites.md) und [Milestone 1: MediaProvider Interface](01-core-mediaprovider-interface.md)

## Architektur: Drei Schichten

```
┌─────────────────────────────────────────────────────────────────────┐
│ SCHICHT 3: KONKRETE MEDIAPROVIDER-PLUGINS                           │
│                                                                     │
│  ┌──────────────────┐  ┌───────────────────────┐                    │
│  │ Jellyfin Provider │  │ SMB Provider           │                   │
│  │ (Milestone 4)     │  │ (Milestone 6)          │                   │
│  │                   │  │                        │                   │
│  │ • REST-API Client │  │ • Multi-Share          │                   │
│  │ • Stream-URLs→MPD │  │ • gio mount (GVFS)     │                   │
│  │                   │  │ • MPD liest nativ      │                   │
│  │ Folgt M7 Contract │  │ Folgt M7 Contract      │                   │
│  └──────────────────┘  └───────────────────────┘                    │
│           ↑                        ↑                                │
│           │ verwendet              │ verwendet                      │
├───────────┼────────────────────────┼────────────────────────────────┤
│ SCHICHT 2: MEDIAPROVIDER INTERFACE (Core-Erweiterung)               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ MediaProvider Interface + Manager (Milestone 1)               │  │
│  │   • Abstract Base Class (ABC) für alle Provider              │  │
│  │   • MediaProviderManager als Modul-Singleton                 │  │
│  │   • Second-Swipe-Logik in der Basisklasse                    │  │
│  │   • Globale Persistierung (music_player_status.json)         │  │
│  │                                                              │  │
│  │ MPD-Adapter (Milestone 2)                                    │  │
│  │   • Wrappt PlayerMPD als MediaProvider                       │  │
│  │   • Registriert als player.provider                          │  │
│  │                                                              │  │
│  │ Card Routing + Config (Milestone 5)                          │  │
│  │   • Erweiterung cards.yaml um provider:-Feld                 │  │
│  │   • decode_card_command() routet an Provider                 │  │
│  │   • misc.list_providers() / get_default_provider()           │  │
│  └──────────────────────────────────────────────────────────────┘  │
│           ↑                                                        │
│           │ nutzt                                                  │
├───────────┼────────────────────────────────────────────────────────┤
│ SCHICHT 1: GENERISCHER PLUGIN-INSTALLER (unabhängig)               │
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐  │
│  │ Plugin-Contract + Registry (Milestone 7)                     │  │
│  │                                                              │  │
│  │ Der Installer:                                               │  │
│  │   1. Liest plugin_registry.yaml (welche Plugins gibt es?)    │  │
│  │   2. Fragt User: "Plugin X installieren? [y/N]"             │  │
│  │   3. Klont Repository → src/jukebox/components/{name}/       │  │
│  │   4. Führt install_dependencies.sh aus (falls vorhanden)     │  │
│  │   5. Installiert requirements.txt (falls vorhanden)          │  │
│  │   6. Aktiviert Plugin in modules.others                      │  │
│  │                                                              │  │
│  │ Funktioniert für JEDEN Plugin-Typ (nicht nur MediaProvider)  │  │
│  └──────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Dependency Tree

```
                    Voraussetzungen (M0)
                    └── jukebox.secrets.retrieve()
                    │
                    ↓ verwendet
                    Schicht 1: Generic Plugin Installer (M7)
                    Unabhängig — nur Installer benötigt
                    ↑
                    │ Plugin-Contract wird befolgt
                    │
                    ├── Schicht 2: MediaProvider Interface
                    │   │
                    │   Milestone 1  ──→  Milestone 2  ──→  Milestone 3  ──→  Schicht 3: Jellyfin (M4)
                    │    (Interface)      (MPD-Adapter)     (API Client)      │     ↑ folgt M7 Contract
                    │   │   ├── beinhaltet PlayCardState-Extraktion           │
                    │   │   ├── M2b (CoverartCache, von M2+M6 genutzt)       │
                    │   │   └── M2c (Async MPD Listener, FUTURE)             │
                    │   │                                                     │
                    │   └── Card Routing (Milestone 5) ←──────────────────────┘
                    │        ├── Erweitert decode_card_command()
                    │        ├── Liest cards.yaml provider:-Feld
                    │        ├── Fügt misc.list_providers() hinzu
                    │        └── Aktualisiert jukebox.default.yaml
                    │
                    └── Schicht 3: SMB (M6) — Benötigt M0+M1+M2+M2b, folgt M7 Contract
                         ├── gio mount, kein Root
                         ├── Cover-Art via CoverartCacheManager (M2b)
                         ├── Multi-Share ("share:/pfad")
                         └── smb.provider.*
```

## MediaProvider — Konzept & Architektur

### Transparente Aggregation

Das Ziel ist **nicht** ein Single-Provider-Switch (entweder MPD oder Jellyfin), sondern eine **transparente Aggregation**: mehrere Provider können gleichzeitig aktiv sein, und ihre Medieninhalte werden zu einer gemeinsamen Bibliothek zusammengeführt.

- Jede RFID-Karte kann in `cards.yaml` einem bestimmten Provider zugeordnet werden
- Das WebUI kann über RPC gezielt auf einzelne Provider zugreifen
- MPD fungiert immer als Audio-Playback-Backend — auch für externe Provider
- Enable/Disable von Providern erfolgt über `modules.others` in der Config (wie bei allen Plugins)

### Architektur (Detail)

```
┌──────────────────────────────────────────────────────────────────┐
│ Karten-Routing (in decode_card_command in rfid/cardutils.py)     │
│                                                                  │
│ 1. Liest cards.yaml: {provider: "jellyfin", value: "folder_id"} │
│ 2. Wenn `provider:`-Feld vorhanden → generiert RPC direkt       │
│    an jellyfin.provider.play_card(folder_id)                     │
│ 3. Wenn kein `provider:`-Feld → bestehender Alias-Pfad (MPD)    │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│ MediaProviderManager (Modul-Singleton)                           │
│                                                                  │
│ Zentralisiert:                                                   │
│ - register_provider(name, provider)                              │
│ - resolve(name) → MediaProvider                                  │
│ - list_providers()                                               │
│ - _last_played_folder (global, via music_player_status.json)     │
│ - _second_swipe_action (von PlayerMPD injiziert)                 │
│ - play_card_callbacks (von playermpd injiziert, für alle Provider)│
└──────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────┐   ┌──────────────────┐   ┌───────────────────────┐
│ MPD         │   │ Jellyfin         │   │ SMB                   │
│ (immer aktiv)│   │ (optional)       │   │ (optional)            │
│             │   │                  │   │                       │
│ Audio-      │   │ Metadaten via    │   │ Multi-Share via       │
│ Backend     │   │ REST-API         │   │ gio mount (GVFS FUSE) │
│ Native      │   │ Stream-URLs an   │   │ MPD liest direkt aus  │
│ Wiedergabe  │   │ MPD delegiert    │   │ gemounteten Pfaden    │
└─────────────┘   └──────────────────┘   └───────────────────────┘
```

### Second-Swipe-Logik

Die Second-Swipe-Erkennung lebt in der **Basisklasse `MediaProvider.play_card()`** und wird von **allen** Providern geerbt. **Kein Provider** (MPD, Jellyfin, SMB) überschreibt `play_card()`.

```python
class MediaProvider(ABC):
    def play_card(self, folder: str, recursive: bool = False):
        from jukebox.mediaprovider import get_manager
        mgr = get_manager()

        last_played = mgr.get_last_played_folder()
        is_second_swipe = (last_played == folder)

        mgr.set_last_played_folder(folder)
        mgr.persist_last_played_folder()

        swipe_action = mgr.get_second_swipe_action()

        state = (mgr.get_play_card_state_second() if is_second_swipe
                 else mgr.get_play_card_state_first())
        mgr.get_play_card_callbacks().run_callbacks(folder, state)

        if is_second_swipe and swipe_action:
            swipe_action()
        else:
            self.play_folder(folder, recursive)
```

**Einheitlicher State:** `PlayerMPD.play_card()` und `PlayerMPD.play_folder()` lesen/schreiben den `_last_played_folder` ebenfalls via `get_manager()`. Dadurch teilen sich alias-basierte und provider-basierte Karten denselben Second-Swipe-State.

**Zentrale `play_card_callbacks`:** Werden in `playermpd/__init__.py` erstellt und via `set_play_card_callbacks()` in den Manager injiziert. Rückwärtskompatibilität: `from components.playermpd import play_card_callbacks` funktioniert weiterhin.

## Nutzungsszenarien

### Provider-basierte Karte (z.B. Jellyfin, SMB)

```
Karte aufgelegt → decode_card_command()
  → detectiert `provider: jellyfin` in cards.yaml
  → RPC: jellyfin.provider.play_card(folder="folder_id_123")
  → MediaProvider.play_card() (Basisklasse, geerbt)
     → Manager: _last_played_folder prüfen & setzen
     → Manager: second_swipe_action ausführen (falls zutreffend)
     → Manager: play_card_callbacks feuern
     → JellyfinMediaProvider.play_folder()
```

### Alias-basierte Karte (MPD, wie bisher)

```
Karte aufgelegt → decode_card_command()
  → alias: play_card → bestehender Pfad (unverändert)
  → RPC: player.ctrl.play_card(folder)
  → PlayerMPD.play_card()
     → Liest _last_played_folder via Manager (nicht mehr aus eigenem dict)
     → Teilt State mit provider-basierten Karten ✓
```

### WebUI (gezielter Provider)

```
Benutzer wählt "Jellyfin" → jellyfin.provider.list_albums()
Benutzer wählt Album → jellyfin.provider.play_folder("id")
```

## RPC-Namespace pro Provider

Jeder Provider wird als eigenständiges Plugin registriert — unter seinem eigenen, bereits geladenen Plugin-Package-Namen:

```python
plugs.register(mpd_provider, package='player', name='provider')
plugs.register(jellyfin_provider, package='jellyfin', name='provider')
plugs.register(smb_provider, package='smb', name='provider')
```

| RPC-Befehl | Ziel |
|---|---|
| `player.ctrl.play_folder` | MPD (Default, wie bisher) |
| `player.provider.play_folder` | MPD-Provider (explizit) |
| `jellyfin.provider.play_folder` | Jellyfin |
| `smb.provider.play_folder` | SMB (mit "share_name:/path") |
| `misc.list_providers` | Alle registrierten Provider |
| `misc.get_default_provider` | Default-Provider-Name |

## cards.yaml — Erweiterung für Multi-Provider

```yaml
# Bestehend (MPD-Default, unverändert):
rfid_card_01:
  alias: play_card
  args: ["AlbumXYZ"]

# Neu (mit Provider-Auswahl):
rfid_card_02:
  provider: "jellyfin"
  value: "folder_id_456"

rfid_card_03:
  provider: "smb"              # Multi-Share: "share_name:/path"
  value: "music:/Rock/AlbumXYZ"
```

**Regeln:**
- `provider:` und `alias:` schließen sich gegenseitig aus
- Provider-basierte Karten: `{provider}.provider.play_card(value)`
- SMB-Karten verwenden das Format `"share_name:/pfad"` (z.B. `"music:/Album"`)
- Beide Formate können parallel in `cards.yaml` existieren

## Plugin-Aktivierung (`modules.others`)

Namen **ohne** `components.`-Präfix:

```yaml
modules:
  others:
    - misc
    # - jellyfin   # ← Einkommentieren zum Aktivieren
    # - smb        # ← Einkommentieren zum Aktivieren
```

## `@plugs.tag` auf allen RPC-Methoden

`plugs.dereference()` prüft `getattr(func, 'plugs_callable', False)`. Jede als Plugin-Instanz registrierte Klasse, deren Methoden via RPC aufrufbar sein sollen, **muss** alle betroffenen Methoden mit `@plugs.tag` dekorieren:

```python
class MpdMediaProvider(MediaProvider):
    @plugs.tag
    def play(self): ...

    @plugs.tag
    def play_folder(self, folder, recursive=False): ...
```

## Roadmap

### Voraussetzungen: Querschnittliche Infrastruktur

| # | Meilenstein | Beschreibung |
|---|---|---|
| 0 | [Prerequisites](00-prerequisites.md) | `jukebox.secrets` — `store()`, `retrieve()`, `delete()`, `list_keys()`. Backing Store: `secrets.yaml` (`chmod 600`), Env-Bootstrap: `secrets.conf`. |
| 0a | [Secrets Infrastructure](00a-secrets-infrastructure.md) | Erweiterte Spezifikation der Secrets-Infrastruktur (siehe auch M0). |
| 1 | [MediaProvider Interface](01-core-mediaprovider-interface.md) | Enthält die `PlayCardState`-Extraktion als Voraussetzung für den Manager. |

### Schicht 1: Generischer Plugin-Installer

| # | Meilenstein | Beschreibung |
|---|---|---|
| 7 | [Generic Plugin Install Process](07-installer-integration.md) | Registry-gesteuerter Installer. Plugin-Contract (Repo-Struktur, `install_dependencies.sh`, `requirements.txt`). Interaktive Plugin-Auswahl. |

### Schicht 2: MediaProvider-Interface (Core-Erweiterung)

| # | Meilenstein | Beschreibung |
|---|---|---|
| 1 | [MediaProvider Interface](01-core-mediaprovider-interface.md) | ABC + Manager (Singleton). Second-swipe in Basisklasse. Interne URI-Scheme (PR #2164). PlayerStatus-Pattern (PR #2164). |
| 2 | [MPD-Adapter](02-mpd-adapter.md) | `MpdMediaProvider` wrappt `PlayerMPD`. Registriert als `player.provider`. `@plugs.tag` auf allen Methoden. |
| 2b | [Cover Art Cache](02b-coverart-cache.md) | `CoverartCacheManager` — mutagen-basierte Cover-Extraktion (adopted from PR #2164). Core-Utility, von MPD und SMB genutzt. |
| 2c | [Async MPD Listener](02c-async-mpd-listener.md) | **Future:** Push-basierter Status-Listener via `mpd.asyncio.MPDClient.idle()` (adopted from PR #2164). Nach stabiler Initial-Implementierung aktivieren. |
| 5 | [Card Routing + Config](05-configuration-rpc.md) | `cards.yaml` erweitert um `provider:`. `decode_card_command()`-Routing. `misc.list_providers()`. |

### Schicht 3: Konkrete MediaProvider-Plugins

| # | Meilenstein | Beschreibung |
|---|---|---|
| 3 | [Jellyfin API Client](03-jellyfin-api-client.md) | REST-Client für Jellyfin 10.8+. Authentifizierung, Library, Stream-URLs. |
| 4 | [Jellyfin MediaProvider](04-jellyfin-plugin.md) | `JellyfinMediaProvider` implementiert `MediaProvider`. Registriert als `jellyfin.provider`. Folgt M7 Contract. |
| 6 | [SMB MediaProvider](06-smb-plugin.md) | `SmbMediaProvider` via gio mount, Multi-Share. Registriert als `smb.provider`. Folgt M7 Contract. |

## Schicht-1-Detail: Plugin-Contract

Plugins, die über den generischen Installer installierbar sein sollen, erfüllen diesen Contract:

| Anforderung | Typ | Jellyfin | SMB |
|---|---|---|---|
| `src/jukebox/components/{name}/` | Pflicht | ✅ | ✅ |
| `__init__.py` mit `@plugs.initialize` | Pflicht | ✅ | ✅ |
| `install_dependencies.sh` | Optional | — | ✅ (gvfs packages) |
| `requirements.txt` | Optional | ✅ (self-doc) | — |
| `configure.sh` | Optional | ✅ (API-Key, Host) | ✅ (Multi-Share interactive) |
| `config_schema.yaml` | Optional | ✅ (WebUI settings form) | ✅ (WebUI settings form) |
| Registry-Eintrag | Pflicht | ✅ | ✅ |

> **Wichtig:** Der Plugin-Contract wurde angepasst: Der Repo-Root **ist** direkt der Plugin-Inhalt.
> Es gibt keine `src/jukebox/components/`-Verschachtelung im Repo.
> Siehe [M7 Contract](07-installer-integration.md) für Details.

## Die Provider im Vergleich

| Aspekt | MPD (local) | Jellyfin | SMB |
|---|---|---|---|
| **Typ** | Lokales Dateisystem | Streaming (HTTP) | Netzwerk-Freigabe(n) |
| **MPD-Rolle** | Native Wiedergabe | HTTP-Stream | Dateisystem-Pfad |
| **Multi-Source** | N/A | N/A | ✅ (mehrere Shares) |
| **Dependencies** | `python-mpd2` | `requests` | GVFS (system) |
| **`play_card()`** | Geerbt | Geerbt | Geerbt |
| **Folder-Format** | relativer Pfad | Jellyfin Item ID | `"share_name:/pfad"` |
| **RPC-Methoden** | `@plugs.tag` | `@plugs.tag` | `@plugs.tag` |
| **Playlist-Aufbau** | PlaylistCollector (rel.) | `clear_playlist()` + `add_to_playlist()` | `clear_playlist()` + `add_to_playlist()` (abs.) |
| **Cover-Art** | CoverartCacheManager (M2b) | Jellyfin API-URLs | CoverartCacheManager (M2b) |
| **Interne URI** | `mpd:folder:path` | `jellyfin:item:id` | `smb:folder:share:/path` |

## Neue ABC-Methoden für Playlist-Management

Das `MediaProvider`-Interface umfasst zwei zusätzliche Methoden, die speziell für externe Provider
(Jellyfin, SMB) benötigt werden, um Playlists ohne die `clear()`-Nebenwirkung von `play_single()`
aufzubauen:

- **`clear_playlist()`** — Löscht die aktuelle Playlist ohne Wiedergabe
- **`add_to_playlist(song_url: str)`** — Fügt einen Track zur Playlist hinzu ohne zu löschen oder abzuspielen

`MpdMediaProvider` implementiert beide durch direkte Delegation an `PlayerMPD.mpd_client`:
- `clear_playlist()` → `self._player.mpd_client.clear()`
- `add_to_playlist(url)` → `self._player.mpd_client.addid(url)`

## Design-Entscheidungen

1. **Kein `mediaprovider.active`-Switch** — Enable/Disable über `modules.others`
2. **MPD immer aktiv** — Audio-Backend für alle externen Provider
3. **Eigenes RPC-Package pro Provider** — `player.provider.*`, `jellyfin.provider.*`, `smb.provider.*`
4. **Module-Singleton für Manager** — konsistent mit `player_ctrl`, `nv_manager()`
5. **Second-Swipe in Basisklasse** — kein Provider überschreibt `play_card()`
6. **Einheitlicher State** — alias- und provider-basierte Karten teilen `_last_played_folder`
7. **Injection-Pattern für Callbacks** — `play_card_callbacks` in `playermpd` erstellt, in Manager injiziert
8. **`@plugs.tag` auf RPC-Methoden** — analog zu `PlayerMPD`
9. **Routing über `decode_card_command()`** — kein separates Routing-Plugin
10. **Plugin-Contract für generischen Installer** — Repo-Root = Plugin-Root (keine Verschachtelung), Dep-Scripts, Registry
11. **Multi-Share Plugin-intern** — SMB verwaltet mehrere Shares innerhalb eines Plugins (`"share:/pfad"`-Format), keine Änderungen an `plugs.py` oder `MediaProviderManager` nötig
12. **Installer-Abhängigkeitsreihenfolge** — Plugin-Auswahl (y/n) und Installation finden beide nach `setup_jukebox_core` statt, sodass `ruamel.yaml` für das Parsen von `plugin_registry.yaml` verfügbar ist. Kein separates `plugin_list.txt` nötig.
13. **`$VIRTUAL_ENV/bin/python3`** — Alle `configure.sh`-Skripte und `setup_plugins.sh`-Funktionen verwenden den venv-Python-Pfad (nicht bare `python3`)
14. **`PlayCardState` in `jukebox.callingback`** — Enum wird aus `components/playermpd/playcontentcallback.py` in das neutrale Core-Modul `jukebox/callingback.py` extrahiert. `playermpd` und `mediaprovider.manager` importieren beide von dort — keine Core→Component-Abhängigkeit. Enum-Werte bleiben unverändert (`firstSwipe=1, secondSwipe=2`).
15. **`jukebox.mediaprovider` ist ein Core-Paket** — wird via regulärem `import` geladen (nicht via `plugs.load()`). Liegt unter `src/jukebox/jukebox/`, nicht unter `components/`. Verwendet keine `@plugs.register`-Dekoratoren. Wird **explizit** in `daemon.py` importiert, um Initialisierungsreihenfolge gegenüber den Plugins zu garantieren.
16. **Kein `modules.others`-Eintrag für `jukebox.mediaprovider`** — das Core-Paket wird durch den expliziten Import in `daemon.py` geladen, bevor die Plugins starten.
17. **Interne URI-Scheme (PR #2164)** — `{provider}:{content_type}:{identifier}` für Content-Addressing zwischen Manager und Providern. Unsichtbar für Benutzer (`cards.yaml` verwendet `provider:`/`value:`).
18. **PlayerStatus-Pattern (PR #2164)** — Zentralisiertes `update()` + ZeroMQ-Publish für Status-Propagation.
19. **CoverartCacheManager (PR #2164)** — Mutagen-basierte Cover-Extraktion aus MP3-Dateien, File-System-Cache, Worker-Thread-Queue. Core-Utility in `jukebox/coverart_cache.py`.
20. **Async MPD Listener (PR #2164, future)** — Push-basierte Status-Updates via `mpd.asyncio.MPDClient.idle()`. Erst nach stabiler Initial-Implementierung aktivieren.
21. **Synergetischer Ansatz** — MediaProvider-Architektur (Strategie) + PR #2164 Features (Taktik). Siehe [assessment-pr2164.md](assessment-pr2164.md) für Details.
