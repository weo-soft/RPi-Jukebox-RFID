# Milestone 4 — Plugin: Jellyfin MediaProvider

## Ziel

`JellyfinMediaProvider` implementieren, der die `MediaProvider`-Schnittstelle erfüllt, und das Plugin-Lifecycle (`@plugs.initialize`, `@plugs.finalize`, `@plugs.atexit`) bereitstellen.

**Registration:** Der Jellyfin-Provider wird als `jellyfin.provider` registriert (unter dem Plugin-Package `jellyfin`, das via `load_all_unnamed` geladen wird):
- `jellyfin.provider.play_folder("folder_id_123")`
- `jellyfin.provider.list_albums()`

**Wichtig:** `plugs.register(instance, package='jellyfin', name='provider')` funktioniert, weil `jellyfin` via `load_all_unnamed` als Plugin-Package geladen ist. Nicht `package='jellyfin_provider'` verwenden — das würde `NameError` werfen.

**Wichtig:** Alle Methoden, die via RPC aufrufbar sein sollen, müssen mit `@plugs.tag` dekoriert werden (`plugs.dereference()` prüft `plugs_callable`-Attribut).

## Abhängigkeiten

- Milestone 0 (Prerequisites — `jukebox.secrets.retrieve()`, `PlayCardState` in `jukebox.callingback`)
- Milestone 1 (MediaProvider Interface)
- Milestone 2 (MPD-Adapter) — MPD wird als Audio-Backend benötigt
- Milestone 3 (Jellyfin API Client) — REST-API-Kommunikation

## Wichtige Design-Entscheidungen

1. **Second-Swipe-Logik über Basisklasse** — `JellyfinMediaProvider` überschreibt `play_card()` NICHT. Die geerbte Implementierung aus `MediaProvider` wird verwendet (globales `_last_played_folder` im Manager, zentrale `play_card_callbacks`, globale `second_swipe_action`).
2. **MPD-Backend wird immer vorausgesetzt** — wenn MPD nicht registriert ist, wird das Plugin nicht initialisiert.
3. **Eigener top-level Config-Key** — Konfiguration unter `jellyfin:` (konsistent mit `playermpd:`, `pulse:`).
4. **Config-Validierung mit aussagekräftigen Fehlern** — fehlende Konfiguration wird erkannt und gemeldet.
5. **Kein `mediaprovider.active`-Switch** — Aktivierung durch Listing in `modules.others` (ohne `components.`-Präfix, z.B. nur `jellyfin`).
6. **Alle RPC-Methoden mit `@plugs.tag`** — analog zu `PlayerMPD`'s `@plugs.tag`-Methoden.
7. **Secrets-Resolution via `retrieve()`** — der API-Key wird bevorzugt aus der Umgebungsvariable `JELLYFIN_API_KEY` gelesen, mit Fallback auf `secrets.yaml` und YAML-Konfiguration. Siehe [Secrets Handling](00a-secrets-infrastructure.md).

## Second-Swipe-Verhalten für Jellyfin

Da `JellyfinMediaProvider` `play_card()` nicht überschreibt, gilt:

```
jellyfin.provider.play_card("folder_id_123")
  → MediaProvider.play_card() (geerbt von Basisklasse)
    → Globales _last_played_folder Check (Manager)
    → Wenn gleicher Wert und second_swipe_action gesetzt:
      → second_swipe_action() (z.B. toggle, play)
    → Sonst: JellyfinMediaProvider.play_folder("folder_id_123")
      → API → Stream-URLs → MPD-Wiedergabe
```

Die Second-Swipe-Aktion wird aus der `playermpd.second_swipe_action`-Config gelesen (wie bei MPD). Callbacks werden zentral über den Manager gefeuert.

## Scope

- `JellyfinMediaProvider` in `jellyfin_provider.py`
- Plugin-Lifecycle in `jellyfin/__init__.py`
- `requirements.txt` für Abhängigkeiten
- Das Plugin registriert sich selbst im `MediaProviderManager`
- Eigenes RPC-Package: `jellyfin.provider.*`

## Konzept

```
┌──────────────────────────────────────────────────────────────────┐
│                    JellyfinMediaProvider                          │
│                                                                  │
│  RFID Card → play_card(folder_id)  (GEERBT VON BASISKLASSE)     │
│       ↓                     (Second-Swipe-Prüfung im Manager)    │
│  JellyfinApiClient.get_items_in_folder(folder_id)                │
│       ↓                                                          │
│  [Audio Item 1, Audio Item 2, ...]                               │
│       ↓                                                          │
│  Für jedes Item: get_stream_url(item_id) → HTTP Stream URL       │
│       ↓                                                          │
│  MpdMediaProvider (Audio-Backend):                               │
│    1. stop()                                                     │
│    2. play_single(stream_url) für jedes Item                     │
│    3. play()                                                     │
└──────────────────────────────────────────────────────────────────┘
```

## Config-Validierung

Bei unvollständiger Konfiguration wird eine aussagekräftige Fehlermeldung geworfen, die vom Plugin-System geloggt wird:

```python
if not host:
    raise ValueError(
        "Jellyfin configuration incomplete: 'jellyfin.host' is not set. "
        "Please add to jukebox.yaml:\n"
        "  jellyfin:\n"
        "    host: http://your-server:8096\n"
        "    api_key: your-api-key"
    )
```

## Dateien

### Neu: `src/jukebox/components/jellyfin/jellyfin_provider.py`

```python
"""
Jellyfin MediaProvider — implementiert die MediaProvider-Schnittstelle.

RPC: Registriert als jellyfin.provider (unter dem vorhandenen 'jellyfin'-Package)
    jellyfin.provider.play_folder("folder_id_123")
    jellyfin.provider.list_albums()

Second-Swipe: Wird von der Basisklasse geerbt (MediaProvider.play_card()).
    JellyfinMediaProvider überschreibt play_card() NICHT.

Verwendet:
- JellyfinApiClient für Metadaten und Library-Struktur
- MPD als Audio-Playback-Backend (HTTP-Stream-URLs)

IMPORTANT: All RPC-callable methods are decorated with @plugs.tag.
"""

import logging
from typing import Optional
import jukebox.cfghandler
import jukebox.plugs as plugs
from jukebox.mediaprovider import MediaProvider

logger = logging.getLogger('jb.jellyfin.provider')
cfg = jukebox.cfghandler.get_handler('jukebox')


class JellyfinMediaProvider(MediaProvider):
    """
    MediaProvider that uses Jellyfin as a media source.

    Inherits play_card() from MediaProvider base class for second-swipe logic.
    MPD is used as the audio playback backend (HTTP stream URLs).
    """

    def __init__(self, mpd_backend: MediaProvider):
        """
        :param mpd_backend: MPD as audio playback backend
        """
        super().__init__()
        self._api: Optional['JellyfinApiClient'] = None
        self._mpd = mpd_backend

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def initialize(self):
        """Connect to Jellyfin server.
        
        Reads configuration from jukebox.yaml:
            jellyfin.host
        
        Reads API key via secret resolution (Environment > secrets.yaml > YAML):
            JELLYFIN_API_KEY (env) > jellyfin.api_key (secrets.yaml) > jellyfin.api_key (yaml)
        
        See documentation/develope00a-secrets-infrastructure.md
        
        Validates that all required config values are present.
        """
        from jukebox.secrets import retrieve

        host = cfg.getn('jellyfin', 'host', default=None)
        api_key = retrieve('jellyfin', 'api_key', env_var='JELLYFIN_API_KEY', default=None)

        errors = []
        if not host:
            errors.append("'jellyfin.host' is not set")
        if not api_key:
            errors.append("'jellyfin.api_key' is not set")
        
        if errors:
            raise ValueError(
                "Jellyfin configuration incomplete:\n  " + "\n  ".join(errors)
            )

        from .jellyfin_api_client import JellyfinApiClient
        self._api = JellyfinApiClient(host, api_key)
        if not self._api.authenticate():
            raise ConnectionError(f"Could not authenticate with Jellyfin at {host}")

        logger.info(f"JellyfinMediaProvider initialized. Server: {host}")

    def shutdown(self):
        """Clean shutdown — close API session."""
        self._api = None
        logger.info("JellyfinMediaProvider shut down")

    # ------------------------------------------------------------------
    # Playback
    # ------------------------------------------------------------------

    @plugs.tag
    def play_folder(self, folder: str, recursive: bool = False):
        """
        'folder' is a Jellyfin item ID. Resolve to audio items and play via MPD.
        Called by the inherited base class play_card() on first swipe.
        """
        items = self._api.get_items_in_folder(folder)
        audio_items = [item for item in items if item.get('Type') == 'Audio']

        if not audio_items:
            logger.warning(f"No audio items found in Jellyfin folder {folder}")
            return

        # Build playlist from stream URLs and push to MPD
        # Clear the playlist once, then add all tracks, then play
        self._mpd.stop()
        self._mpd.clear_playlist()
        for item in audio_items:
            stream_url = self._api.get_stream_url(item['Id'])
            self._mpd.add_to_playlist(stream_url)

        self._mpd.play()
        logger.info(f"Playing {len(audio_items)} tracks from folder {folder}")

    @plugs.tag
    def play_single(self, song_url: str):
        """Play a single track by its Jellyfin item ID."""
        stream_url = self._api.get_stream_url(song_url)
        self._mpd.play_single(stream_url)

    @plugs.tag
    def play_album(self, albumartist: str, album: str):
        """Play an album by looking it up in Jellyfin."""
        albums = self._api.get_albums()
        target = [a for a in albums if a.get('Name') == album]
        if target:
            self.play_folder(target[0]['Id'])
        else:
            logger.warning(f"Album '{album}' not found in Jellyfin library")

    # ------------------------------------------------------------------
    # Status (delegiert an MPD)
    # ------------------------------------------------------------------

    @plugs.tag
    def status(self) -> dict:
        return self._mpd.status()

    @plugs.tag
    def get_current_song(self) -> Optional[dict]:
        return self._mpd.get_current_song()

    @plugs.tag
    def playlistinfo(self) -> list:
        return self._mpd.playlistinfo()

    # ------------------------------------------------------------------
    # Navigation (delegiert an MPD)
    # ------------------------------------------------------------------

    @plugs.tag
    def play(self):       self._mpd.play()
    @plugs.tag
    def stop(self):       self._mpd.stop()
    @plugs.tag
    def next(self):       self._mpd.next()
    @plugs.tag
    def prev(self):       self._mpd.prev()
    @plugs.tag
    def toggle(self):     self._mpd.toggle()
    @plugs.tag
    def pause(self, state: int = 1): self._mpd.pause(state)
    @plugs.tag
    def seek(self, new_time: float): self._mpd.seek(new_time)
    @plugs.tag
    def rewind(self):     self._mpd.rewind()

    @plugs.tag
    def clear_playlist(self):
        """Delegate to MPD backend. Required by MediaProvider ABC."""
        self._mpd.clear_playlist()

    @plugs.tag
    def add_to_playlist(self, song_url: str):
        """Delegate to MPD backend. Required by MediaProvider ABC."""
        self._mpd.add_to_playlist(song_url)

    # ------------------------------------------------------------------
    # Library (via Jellyfin API)
    # ------------------------------------------------------------------

    @plugs.tag
    def list_albums(self) -> list:
        return self._api.get_albums()

    @plugs.tag
    def get_folder_content(self, folder: str) -> list:
        return self._api.get_items_in_folder(folder)

    @plugs.tag
    def list_all_dirs(self) -> list:
        return self._api.get_views()

    # ------------------------------------------------------------------
    # Cover Art
    # ------------------------------------------------------------------

    @plugs.tag
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        """Return Jellyfin cover art URL for an item."""
        return self._api.get_coverart_url(song_url)

    @plugs.tag
    def get_album_coverart(self, albumartist: str, album: str) -> Optional[str]:
        albums = self._api.get_albums()
        target = [a for a in albums if a.get('Name') == album]
        if target:
            return self._api.get_coverart_url(target[0]['Id'])
        return None

    # ------------------------------------------------------------------
    # Library Management
    # ------------------------------------------------------------------

    @plugs.tag
    def update(self):
        """Jellyfin updates are server-managed. Just refresh local cache."""
        pass

    @plugs.tag
    def update_wait(self):
        self.update()

    @plugs.tag
    def get_player_type_and_version(self) -> str:
        return f"jellyfin (via {self._mpd.get_player_type_and_version()})"
```

### Neu: `src/jukebox/components/jellyfin/__init__.py`

```python
"""
Jellyfin Media Provider Plugin

Second-Swipe-Logik: Wird von der Basisklasse MediaProvider.play_card() geerbt.
    JellyfinMediaProvider überschreibt play_card() NICHT.
    Die globale second_swipe_action kommt aus playermpd.second_swipe_action (vom Manager).
    play_card_callbacks werden zentral über den Manager gefeuert.
"""

import logging
import jukebox.plugs as plugs
import jukebox.cfghandler

logger = logging.getLogger('jb.jellyfin')
cfg = jukebox.cfghandler.get_handler('jukebox')

jellyfin_provider_instance = None


@plugs.initialize
def initialize():
    """
    Initialize Jellyfin provider.
    
    Requires MPD to be registered as a MediaProvider (audio backend).
    If MPD is not available, the plugin logs an error and skips initialization.
    
    play_card() wird von der Basisklasse geerbt — keine eigene Implementierung nötig.
    Second-Swipe-Aktion wird vom Manager bereitgestellt (aus playermpd-Config).
    Callbacks werden zentral vom Manager gefeuert.
    """
    global jellyfin_provider_instance

    # Prüfen, ob MPD als Audio-Backend verfügbar ist
    from jukebox.mediaprovider import get_manager
    try:
        mpd_provider = get_manager().get_provider('mpd')
    except KeyError:
        logger.error("MPD provider not found. "
                      "Jellyfin requires MPD as audio backend. Aborting.")
        return

    from .jellyfin_provider import JellyfinMediaProvider

    jellyfin_provider_instance = JellyfinMediaProvider(mpd_backend=mpd_provider)
    jellyfin_provider_instance.initialize()

    get_manager().register_provider('jellyfin', jellyfin_provider_instance)

    # Jellyfin-Provider unter dem 'jellyfin'-Package registrieren
    plugs.register(jellyfin_provider_instance, package='jellyfin', name='provider')

    logger.info("Jellyfin Media Provider initialized and registered")


@plugs.finalize
def finalize():
    """Publish initial state after all plugins are loaded."""
    pass


@plugs.atexit
def atexit(**kwargs):
    """Shutdown Jellyfin provider gracefully."""
    global jellyfin_provider_instance
    if jellyfin_provider_instance is not None:
        jellyfin_provider_instance.shutdown()
        jellyfin_provider_instance = None
        logger.info("Jellyfin Media Provider shut down")
```

### Neu: `src/jukebox/components/jellyfin/requirements.txt`

```
requests>=2.28.0
```

## RPC-Namespace

Nach diesem Milestone ist der Jellyfin-Provider über RPC erreichbar:

| RPC | Beschreibung |
|---|---|
| `jellyfin.provider.play_folder("id")` | Ordner/Album abspielen |
| `jellyfin.provider.list_albums()` | Alben auflisten |
| `jellyfin.provider.get_folder_content("id")` | Ordnerinhalt browsen |
| `jellyfin.provider.get_album_coverart("Artist", "Album")` | Cover Art |
| `misc.list_providers()` | Alle Provider auflisten (inkl. jellyfin) |

## Installer Contract Compliance

Das Jellyfin-Plugin folgt dem [Plugin-Contract von Milestone 7](07-installer-integration.md).

| Contract-Anforderung | Erfüllung durch Jellyfin |
|---|---|
| Repository-Struktur `src/jukebox/components/jellyfin/` | Dieses Plugin ist im Pfad `src/jukebox/components/jellyfin/` im Repo |
| `__init__.py` mit Plugin-Lifecycle | Siehe `jellyfin/__init__.py` oben |
| `requirements.txt` (optional) | `requests>=2.28.0` (zur Selbst-Dokumentation; `requests` ist bereits Core-Dependency) |
| `install_dependencies.sh` (optional) | Nicht benötigt — keine System-Abhängigkeiten |
| Registry-Eintrag in `plugin_registry.yaml` | Siehe Milestone 7 |

Die einzige externe Python-Abhängigkeit ist `requests`. Diese ist bereits eine Core-Abhängigkeit des Projekts (`requirements.txt`, Zeile 18: `requests`). Der Core-Installer installiert `requests` automatisch — **kein zusätzlicher Installationsschritt nötig**.

## Aktivierung (manuell)

Falls das Plugin nicht über den Installer installiert wurde:

1. **Plugin klonen:**
   ```bash
   git clone https://github.com/.../jellyfin-plugin.git \
       src/jukebox/components/jellyfin/
   ```

2. **Config erstellen:**
   ```yaml
   # jukebox.yaml
   modules:
     others:
       - jellyfin
   
   jellyfin:
     host: http://dein-jellyfin-server:8096
     # api_key leer lassen — wird aus secrets.conf geladen
   ```

3. **Secrets-Datei anlegen** (`shared/settings/secrets.conf`, `chmod 600`):
   ```bash
   # secrets.conf
   JELLYFIN_API_KEY=dein-api-key
   ```

   Siehe [Secrets Handling](00a-secrets-infrastructure.md) für Details.

4. **Karten zuweisen:**
   ```yaml
   # cards.yaml
   rfid_card_01:
     provider: jellyfin
     value: "folder_id_456"
   ```

## Tests

### Neu: `test/jellyfin/test_jellyfin_provider.py`

- Test: `JellyfinMediaProvider`-Initialisierung mit gemocktem API-Client und MPD-Backend
- Test: `play_folder()` baut korrekte Playlist aus Audio-Items
- Test: `play_folder()` mit leerem Ordner (keine Audio-Items)
- Test: `list_albums()` delegiert an API-Client
- Test: `initialize()` mit fehlender Config → ValueError
- Test: `shutdown()` schließt API-Client sauber
- Test: `play_card()` wird NICHT überschrieben (prüft, dass `type(obj).play_card is MediaProvider.play_card`)
- Test: Alle Methoden haben `plugs_callable`-Attribut (`@plugs.tag` wirksam)

## Akzeptanzkriterien

- [ ] `JellyfinMediaProvider` implementiert alle `MediaProvider`-Methoden
- [ ] Alle RPC-callable Methoden sind mit `@plugs.tag` dekoriert
- [ ] Playlist basiert auf Stream-URLs (keine Dateien von lokalem Speicher)
- [ ] `JellyfinMediaProvider.play_card()` ist NICHT überschrieben (Basisklasse wird verwendet)
- [ ] Second-Swipe-Verhalten gleich wie bei MPD (globale Einstellung)
- [ ] `play_card_callbacks` werden gefeuert (zentral über Manager)
- [ ] Plugin registriert sich nur, wenn MPD-Backend verfügbar ist
- [ ] Plugin validiert Konfiguration und gibt aussagekräftige Fehlermeldungen
- [ ] Plugin registriert sich als `jellyfin.provider`
- [ ] `@atexit` shutdown funktioniert fehlerfrei
- [ ] `play_folder()` spielt Audio-Items via MPD ab
- [ ] Fehlkonfiguration (fehlender API-Key, kein MPD) wird geloggt, nicht gecrasht
- [ ] `jellyfin.provider.play_folder("id")` ist über RPC aufrufbar