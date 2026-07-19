# Milestone 2 — Core: MPD-Adapter

## Ziel

`MpdMediaProvider` erstellen, der die `MediaProvider`-Schnittstelle implementiert und an den bestehenden `PlayerMPD` delegiert. Das bestehende `playermpd`-Plugin wird minimal erweitert, um den Provider während `@plugs.initialize` zu registrieren.

**Registration:** Der MPD-Provider wird als `player.provider` registriert (unter dem bestehenden Plugin-Package `player`):
- `player.provider.play_folder("Album")` — MediaProvider-Interface
- `player.ctrl.play_folder("Album")` — bleibt wie bisher erhalten (direkter PlayerMPD-Zugriff)

**Wichtig:** `plugs.register(instance, package='player', name='provider')` funktioniert, weil `player` via `load_all_named` bereits als Plugin-Package geladen ist. Nicht `package='mpd_provider'` verwenden — das würde `NameError` werfen.

**Wichtig:** Alle Methoden, die via RPC aufrufbar sein sollen, müssen mit `@plugs.tag` dekoriert werden (`plugs.dereference()` prüft `plugs_callable`-Attribut).

## Wichtige Design-Entscheidungen

### `play_card()` wird NICHT überschrieben

**`MpdMediaProvider` überschreibt `play_card()` NICHT.** Die Basisklassen-Implementierung von `MediaProvider.play_card()` wird geerbt. Gründe:

1. **Einheitliche Second-Swipe-Erkennung** für alle Provider (globales `_last_played_folder` im Manager)
2. **Zentrale `play_card_callbacks`** für alle Provider (aus dem Manager gefeuert)
3. **Globale `second_swipe_action`** (einmalig aus `playermpd`-Config aufgelöst, im Manager gespeichert)
4. **`PlayerMPD` wird minimal geändert** — `play_card()` und `play_folder()` lesen/schreiben `_last_played_folder` via Manager

`PlayerMPD.play_card()` (das bestehende System) wird weiterhin für **alias-basierte Karten** verwendet, die direkt via `player.ctrl.play_card()` aufgerufen werden. Die **Provider-basierten Karten** hingegen durchlaufen `MpdMediaProvider.play_card()` (geerbt von Basisklasse) → `MpdMediaProvider.play_folder()` → `PlayerMPD.play_folder()`.

Beide Pfade teilen sich denselben `_last_played_folder` im Manager (via `get_manager().get_last_played_folder()` / `set_last_played_folder()`).

### `play_folder()` — File/Directory Auto-Detection (für unified `cards.yaml`)

**Für die [cards.yaml Vereinheitlichung](cards-yaml-unification.md):** `MpdMediaProvider.play_folder()`
detektiert automatisch, ob der übergebene Wert eine Datei oder ein Verzeichnis ist:

```python
@plugs.tag
def play_folder(self, folder: str, recursive: bool = False):
    """
    Play folder or single file via MPD.
    
    Auto-detects file vs directory: if 'folder' resolves to a file path,
    routes internally to play_single(). Otherwise delegates to PlayerMPD.play_folder().
    
    This enables the unified cards.yaml format:
        provider: mpd
        value: "AlbumXYZ"        → play_folder()
        value: "song.mp3"         → auto-detected as file → play_single()
    """
    music_lib_path = components.player.get_music_library_path()
    full_path = os.path.join(music_lib_path, folder)
    
    if os.path.isfile(full_path):
        logger.debug(f"Detected file (not folder): {folder}")
        self._player.play_single(folder)
    else:
        self._player.play_folder(folder, recursive)
```

**Begründung:** Im vereinheitlichten `cards.yaml`-Format gibt es kein `play_single`-Alias mehr.
Alle Playback-Karten verwenden `provider: mpd` + `value:`. Die Unterscheidung zwischen
Datei und Verzeichnis erfolgt transparent im Provider.

**Kein Verstoß gegen die "No-Override"-Regel:** `play_folder()` ist eine abstrakte Methode
der ABC und **muss** überschrieben werden. Die File/Directory-Detection ist eine
MPD-spezifische Optimierung und ändert nicht das Second-Swipe-Verhalten.

## Interne URI-Scheme (Adopted from PR #2164)

**Adopted from PR #2164:** Das interne Content-Addressing verwendet ein URI-Schema der Form
`{provider}:{content_type}:{identifier}`. Dieses Schema wird **nur intern** zwischen
`PlayerCtrl`-Arbiter und Backend verwendet und ist **nicht** in `cards.yaml` sichtbar
(dort bleibt das `provider:`/`value:`-Feld).

```
Interne URIs (nicht benutzersichtbar):
  mpd:folder:path/to/album     → MPD, Ordner relativ zur Music-Library
  mpd:file:path/to/song.mp3    → MPD, einzelne Datei
  mpd:album:Feuerwehr:albumartist:Benjamin  → MPD, Album-Suche
  jellyfin:item:folder_id_123  → Jellyfin, Item-ID
  jellyfin:track:track_id_456  → Jellyfin, einzelner Track
  smb:folder:music:/Album      → SMB, Share+Ordner
  smb:file:music:/song.mp3     → SMB, einzelne Datei im Share

Vorteile (aus PR #2164):
  - Einheitliches, parsebares Format für alle Content-Typen
  - Backend-Typ und Content-Typ sind im URI codiert (kein implizites Wissen nötig)
  - Neue Backends erweitern nur den player_type-Prefix (z.B. spotify:track:id)
  - Card-Routing via decode_card_command() übersetzt provider: + value: in URIs
```

Die URI-Konvertierung findet in `decode_card_command()` statt (Milestone 5):
```python
# cards.yaml: {provider: "jellyfin", value: "folder_id_123"}
# → decode_card_command() generiert:
#   RPC: jellyfin.provider.play_card(folder="folder_id_123")
#   → MediaProvider.play_card() konvertiert zu:
#     URI: jellyfin:item:folder_id_123
#     → JellyfinMediaProvider.play_folder("folder_id_123")
```

## Datenfluss

```
Provider-basierte Karte (cards.yaml mit "provider: mpd"):
  decode_card_command() → RPC: player.provider.play_card(folder)
    → MediaProvider.play_card() (Basisklasse, geerbt)
      → Intern: URI = mpd:folder:{folder}
      → Globales _last_played_folder Check (Manager)
      → Speichert/persistiert _last_played_folder (Manager)
      → Feuert play_card_callbacks (Manager)
      → MpdMediaProvider.play_folder(folder, recursive)
        → PlayerMPD.play_folder(folder, recursive)
          → Setzt _last_played_folder via Manager ✓

Alias-basierte Karte (cards.yaml mit "alias: play_card"):
  decode_card_command() → RPC: player.ctrl.play_card(folder)
    → PlayerMPD.play_card()
      → Liest _last_played_folder via Manager ✓
      → Feuert play_card_callbacks
      → PlayerMPD.play_folder(folder, recursive)
        → Setzt _last_played_folder via Manager ✓
```

## Abhängigkeiten

- Milestone 0 (Prerequisites — `jukebox.secrets`)
- Milestone 1 (MediaProvider Interface + Manager) — beinhaltet `PlayCardState` in `jukebox.callingback`
- Milestone 2b (CoverartCacheManager) — für Cover-Art-Extraktion

## Scope

- Neue Datei `src/jukebox/components/playermpd/mpd_provider.py`
- Minimale Erweiterung von `src/jukebox/components/playermpd/__init__.py`
- **Minimale Änderungen** an `PlayerMPD`: `play_card()`, `play_folder()`, `get_current_song()`
- `MpdMediaProvider` teilt sich die bestehende `PlayerMPD`-Instanz (keine doppelte Initialisierung)
- Alle Provider-Methoden sind mit `@plugs.tag` dekoriert
- **Cover-Art-Extraktion** — `get_single_coverart()` verwendet `CoverartCacheManager` (M2b)
- **`PlayerStatus`-Pattern** — Status-Propagation via `update()` + ZeroMQ-Publish (adopted from PR #2164)

## Dateien

### Neu: `src/jukebox/components/playermpd/mpd_provider.py`

```python
import logging
from typing import Optional
import jukebox.plugs as plugs
from jukebox.mediaprovider import MediaProvider

logger = logging.getLogger('jb.mpd_provider')


class MpdMediaProvider(MediaProvider):
    """
    Adapter that implements the MediaProvider interface for MPD.

    Delegates all calls to the existing PlayerMPD instance.
    The PlayerMPD instance is injected after creation by the plugin's @initialize.

    IMPORTANT: Does NOT override play_card(). The base class MediaProvider.play_card()
    is inherited, which handles:
    - Global second-swipe detection (via Manager._last_played_folder)
    - Global second-swipe action (via Manager._second_swipe_action)
    - Global play_card_callbacks (via Manager)
    - Delegates to self.play_folder() on first swipe

    IMPORTANT: All methods are decorated with @plugs.tag so they are RPC-callable.
    """

    def __init__(self):
        super().__init__()
        # Injected by playermpd/__init__.py after PlayerMPD is created
        self._player = None

    def initialize(self):
        """MPD connection is handled by PlayerMPD.__init__(). Nothing to do."""
        pass

    def shutdown(self):
        if self._player:
            return self._player.exit()

    # --- Delegation an PlayerMPD ---
    # NOTE: play_card() is NOT overridden — inherited from MediaProvider base class

    @plugs.tag
    def play(self):
        self._player.play()

    @plugs.tag
    def stop(self):
        self._player.stop()

    @plugs.tag
    def next(self):
        self._player.next()

    @plugs.tag
    def prev(self):
        self._player.prev()

    @plugs.tag
    def play_folder(self, folder: str, recursive: bool = False):
        """
        Play folder or single file via MPD.

        Auto-detects file vs directory: if 'folder' resolves to a file path,
        routes internally to play_single(). Otherwise delegates to PlayerMPD.play_folder().

        This enables the unified cards.yaml format:
            provider: mpd
            value: "AlbumXYZ"        → play_folder()
            value: "song.mp3"         → auto-detected as file → play_single()

        Called by the inherited base class play_card() on first swipe,
        or called directly via player.provider.play_folder().
        """
        music_lib_path = components.player.get_music_library_path()
        full_path = os.path.join(music_lib_path, folder)

        if os.path.isfile(full_path):
            logger.debug(f"Detected file (not folder): {folder}")
            self._player.play_single(folder)
        else:
            self._player.play_folder(folder, recursive)

    @plugs.tag
    def play_single(self, song_url: str):
        self._player.play_single(song_url)

    @plugs.tag
    def play_album(self, albumartist: str, album: str):
        self._player.play_album(albumartist, album)

    @plugs.tag
    def clear_playlist(self):
        """Clear the playlist without starting playback."""
        with self._player.mpd_lock:
            self._player.mpd_client.clear()

    @plugs.tag
    def add_to_playlist(self, song_url: str):
        """Add a single track URL to the playlist without clearing or playing."""
        with self._player.mpd_lock:
            self._player.mpd_client.addid(song_url)

    @plugs.tag
    def toggle(self):
        self._player.toggle()

    @plugs.tag
    def pause(self, state: int = 1):
        self._player.pause(state)

    @plugs.tag
    def seek(self, new_time: float):
        self._player.seek(new_time)

    @plugs.tag
    def rewind(self):
        self._player.rewind()

    @plugs.tag
    def status(self) -> dict:
        return self._player.playerstatus()

    @plugs.tag
    def get_current_song(self) -> Optional[dict]:
        return self._player.mpd_status

    @plugs.tag
    def playlistinfo(self) -> list:
        return self._player.playlistinfo()

    @plugs.tag
    def list_albums(self) -> list:
        return self._player.list_albums()

    @plugs.tag
    def get_folder_content(self, folder: str) -> list:
        return self._player.get_folder_content(folder)

    @plugs.tag
    def list_all_dirs(self) -> list:
        return self._player.list_all_dirs()

    @plugs.tag
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        return self._player.get_single_coverart(song_url)

    @plugs.tag
    def get_album_coverart(self, albumartist: str, album: str) -> Optional[str]:
        return self._player.get_album_coverart(albumartist, album)

    @plugs.tag
    def update(self):
        return self._player.update()

    @plugs.tag
    def update_wait(self):
        return self._player.update_wait()

    @plugs.tag
    def get_player_type_and_version(self) -> str:
        return self._player.get_player_type_and_version()
```

### Geändert: `src/jukebox/components/playermpd/__init__.py`

Die `initialize()`-Funktion wird um die MediaProvider-Registrierung und die Callback-Injection ergänzt.

**Änderungen im Überblick:**
1. `play_card_callbacks` wird wie bisher erstellt, dann via `set_play_card_callbacks()` in den Manager injiziert
2. `initialize()`: MPD-Provider registrieren + `second_swipe_action` + `set_persist_callback()` in Manager injizieren
3. `PlayerMPD.play_card()`: Liest `_last_played_folder` via `get_manager().get_last_played_folder()`
4. `PlayerMPD.play_folder()`: Schreibt via `get_manager().set_last_played_folder(folder)` — **bestehenden direkten dict-write (Line 641) ENTFERNEN und durch Manager-Aufruf ERSETZEN**
5. `PlayerMPD.replay()` und `replay_if_stopped()`: Lesen via `get_manager().get_last_played_folder()` statt aus `music_player_status` direkt
6. `PlayerMPD.get_current_song()`: ungenutzter `param` entfernt

```python
# ===== In initialize() =====

@plugs.initialize
def initialize():
    global player_ctrl
    player_ctrl = PlayerMPD()
    plugs.register(player_ctrl, name='ctrl')
    
    # PlayContentCallbacks wird wie bisher erstellt (mit MPD-Lock-Context)
    global play_card_callbacks
    play_card_callbacks = PlayContentCallbacks[PlayCardState](
        'play_card_callbacks', logger, context=player_ctrl.mpd_lock
    )
    
    # ==== NEU: Callbacks, persist + second_swipe_action in Manager injizieren ====
    from jukebox.mediaprovider import get_manager
    get_manager().set_play_card_callbacks(play_card_callbacks)
    get_manager().set_second_swipe_action(player_ctrl.second_swipe_action)
    # Persist-Callback: synchronisiert _last_played_folder ins music_player_status dict
    # und persistiert via NvManager (ersetzt den bisherigen direkten dict-write in play_folder())
    def _persist_to_music_player_status(folder: str):
        if 'player_status' not in player_ctrl.music_player_status:
            player_ctrl.music_player_status['player_status'] = {}
        player_ctrl.music_player_status['player_status']['last_played_folder'] = folder
        player_ctrl.music_player_status.save_to_json()
    get_manager().set_persist_callback(_persist_to_music_player_status)

    # NEU: Manager's _last_played_folder mit dem persisted value initialisieren
    # (stellt sicher, dass alias- und provider-basierte Pfade denselben Start-State haben)
    restored = player_ctrl.music_player_status.get('player_status', {}).get('last_played_folder', '')
    get_manager().set_last_played_folder(restored)
    logger.debug(f"Restored _last_played_folder from music_player_status: '{restored}'")

    # MPD als MediaProvider registrieren
    from .mpd_provider import MpdMediaProvider
    mpd_provider = MpdMediaProvider()
    mpd_provider._player = player_ctrl  # Bestehende Instanz teilen
    mpd_provider.initialize()
    
    get_manager().register_provider('mpd', mpd_provider)
    get_manager().set_default('mpd')
    
    # MPD-Provider als eigenes Plugin unter 'player'-Package registrieren
    plugs.register(mpd_provider, package='player', name='provider')
    # ================================================================
    
    # Update mpc library
    library_update = cfg.setndefault('playermpd', 'library', 'update_on_startup', value=True)
    if library_update:
        player_ctrl.update()
    
    # Check user rights on music library
    library_check_user_rights = cfg.setndefault('playermpd', 'library', 'check_user_rights', value=True)
    if library_check_user_rights is True:
        music_library_path = components.player.get_music_library_path()
        if music_library_path is not None:
            logger.info(f"Change user rights for {music_library_path}")
            misc.recursive_chmod(music_library_path, mode_files=0o666, mode_dirs=0o777)


# ===== In PlayerMPD.play_card() — Minimal-Änderung =====

@plugs.tag
def play_card(self, folder: str, recursive: bool = False):
    # NEU: _last_played_folder via Manager lesen (nicht aus music_player_status direkt)
    from jukebox.mediaprovider import get_manager
    logger.debug(f"last_played_folder = {get_manager().get_last_played_folder()}")
    with self.mpd_lock:
        is_second_swipe = get_manager().get_last_played_folder() == folder
    if self.second_swipe_action is not None and is_second_swipe:
        logger.debug('Calling second swipe action')
        play_card_callbacks.run_callbacks(folder, PlayCardState.secondSwipe)
        self.second_swipe_action()
    else:
        logger.debug('Calling first swipe action')
        play_card_callbacks.run_callbacks(folder, PlayCardState.firstSwipe)
        # NEU: set_last_played_folder + persist (mirrors ABC play_card())
        get_manager().set_last_played_folder(folder)
        get_manager().persist_last_played_folder()
        self.play_folder(folder, recursive)


# ===== In PlayerMPD.play_folder() — Minimal-Änderung =====

@plugs.tag
def play_folder(self, folder: str, recursive: bool = False) -> None:
    with self.mpd_lock:
        logger.info(f"Play folder: '{folder}'")
        self.mpd_client.clear()

        plc = playlistgenerator.PlaylistCollector(components.player.get_music_library_path())
        plc.parse(folder, recursive)
        uri = '--unset--'
        try:
            for uri in plc:
                self.mpd_client.addid(uri)
        except mpd.base.CommandError as e:
            logger.error(f"{e.__class__.__qualname__}: {e} at uri {uri}")
        except Exception as e:
            logger.error(f"{e.__class__.__qualname__}: {e} at uri {uri}")

        # NEU: _last_played_folder via Manager setzen (nicht in music_player_status direkt)
        from jukebox.mediaprovider import get_manager
        get_manager().set_last_played_folder(folder)

        self.current_folder_status = self.music_player_status['audio_folder_status'].get(folder)
        if self.current_folder_status is None:
            self.current_folder_status = self.music_player_status['audio_folder_status'][folder] = {}

        self.mpd_client.play()
```

### Geändert: `PlayerMPD.get_current_song()` in `playermpd/__init__.py`

```python
@plugs.tag
def get_current_song(self) -> Optional[dict]:
    return self.mpd_status
```

Änderung: Der ungenutzte `param`-Parameter wird entfernt. Der Parameter wurde nie verwendet (die Methode gab immer nur `self.mpd_status` zurück). Dies macht die Signatur konsistent mit dem `MediaProvider`-Interface.

### Geändert: `PlayerMPD.replay()` und `replay_if_stopped()` — über Manager lesen

Diese Methoden lesen bisher direkt aus `self.music_player_status['player_status']['last_played_folder']`. Sie müssen auf den Manager umgestellt werden, damit sie denselben State wie alle anderen Pfade verwenden:

```python
@plugs.tag
def replay(self):
    """
    Re-start playing the last-played folder

    Will reset settings to folder config"""
    logger.debug("Replay")
    from jukebox.mediaprovider import get_manager
    with self.mpd_lock:
        self.play_folder(get_manager().get_last_played_folder())


@plugs.tag
def replay_if_stopped(self):
    """
    Re-start playing the last-played folder unless playlist is still playing

    > [!NOTE]
    > To me this seems much like the behaviour of play,
    > but we keep it as it is specifically implemented in box 2.X"""
    from jukebox.mediaprovider import get_manager
    with self.mpd_lock:
        if self.mpd_status['state'] == 'stop':
            self.play_folder(get_manager().get_last_played_folder())
```

## Tests

- `MpdMediaProvider`-Instanz kann erstellt werden
- `MpdMediaProvider` registriert sich im `MediaProviderManager`
- `MpdMediaProvider` überschreibt `play_card()` NICHT (prüft mit `hasattr` oder `isinstance`)
- Alle `MpdMediaProvider`-Methoden haben `plugs_callable`-Attribut (`@plugs.tag` wirksam)
- `player.ctrl.*` RPC-Aufrufe funktionieren weiterhin (Integrationstest)
- `player.provider.*` RPC-Aufrufe funktionieren
- `play_card_callbacks` ist identisch mit `get_manager().get_play_card_callbacks()`
- `PlayerMPD.play_card()` liest `_last_played_folder` via Manager
- `PlayerMPD.play_folder()` schreibt `_last_played_folder` via Manager

## RPC-Namespace

Nach diesem Milestone ist der MPD-Provider über zwei Wege erreichbar:

| RPC | Beschreibung |
|---|---|
| `player.ctrl.play_folder("Album")` | Wie bisher — direkt PlayerMPD |
| `player.provider.play_folder("Album")` | MediaProvider-Interface — für einheitlichen Zugriff |

## Auswirkungen

- Nach diesem Milestone ist MPD als `MediaProvider` registriert
- `get_manager().resolve()` liefert den MPD-Provider
- `get_manager().resolve('mpd')` liefert den MPD-Provider
- Rückwärtskompatibilität: `player.ctrl.*` RPC funktioniert wie zuvor
- Neuer RPC-Zugang: `player.provider.*`
- Second-Swipe-Logik für Provider-basierte MPD-Karten über Basisklasse (global)
- `PlayerMPD.play_card()` und `play_folder()` teilen `_last_played_folder` via Manager
- `play_card_callbacks` zentral im Manager (via Injection aus playermpd)
- `PlayerMPD.get_current_song()` ohne `param`-Parameter (Signatur-Änderung: `get_current_song(self, param)` → `get_current_song(self)`)

## Akzeptanzkriterien

- [ ] `MpdMediaProvider` kann importiert werden
- [ ] `MpdMediaProvider` implementiert alle abstrakten Methoden von `MediaProvider`
- [ ] Alle `MpdMediaProvider`-Methoden sind mit `@plugs.tag` dekoriert
- [ ] `MpdMediaProvider.play_card()` ist NICHT überschrieben (Basisklasse wird verwendet)
- [ ] `MpdMediaProvider` registriert keine eigene `play_card`-Methode im RPC
- [ ] Nach dem Start ist MPD als Provider registriert und als Default gesetzt
- [ ] `get_manager().resolve()` gibt eine gültige Instanz zurück
- [ ] `player.provider.*` RPC-Aufrufe funktionieren
- [ ] Alle bestehenden `player.ctrl.*` RPC-Aufrufe funktionieren
- [ ] `PlayerMPD.get_current_song()` hat keinen `param`-Parameter mehr
- [ ] `PlayerMPD.play_card()` liest `_last_played_folder` via `get_manager().get_last_played_folder()`
- [ ] `PlayerMPD.play_folder()` schreibt `_last_played_folder` via `get_manager().set_last_played_folder()`
- [ ] `play_card_callbacks` ist via `get_manager().get_play_card_callbacks()` abrufbar
- [ ] `from components.playermpd import play_card_callbacks` funktioniert weiterhin