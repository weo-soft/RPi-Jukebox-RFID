# Milestone 1 — Core: MediaProvider Interface

## Ziel

Abstrakte Basisklasse `MediaProvider` + `MediaProviderManager` schaffen, die es ermöglicht, verschiedene Medienquellen einheitlich anzusprechen.

## Kern-Design-Entscheidungen

1. **Module-Singleton für den Manager** — konsistent mit bestehenden Patterns (`player_ctrl`, `pulse_control`, `nv_manager()`). Keine class-level-Variablen.
2. **Kein `mediaprovider.active`-Switch** — Enable/Disable erfolgt über `modules.others` (wie bei allen Plugins). Alle geladenen Provider sind aktiv.
3. **Minimale Änderung** an `daemon.py` (expliziter `import jukebox.mediaprovider` vor Plugin-Loading zur Sicherstellung der Initialisierungsreihenfolge). **Keine Änderungen** an `plugs.py`, `rpc/server.py` (nur minimale Änderungen an `PlayerMPD` — siehe unten).
4. **Second-Swipe-Logik in der Basisklasse** — `play_card()` implementiert die gemeinsame Erkennung und delegiert an `play_folder()`. Alle Provider erben diese Methode.
5. **Globale Persistierung von `last_played_folder`** — wird zentral über den `MediaProviderManager` verwaltet und über das bestehende `music_player_status.json` persistiert (kein per-Provider-State).
6. **Globale `second_swipe_action`** — wird einmalig aus der `playermpd`-Konfiguration aufgelöst und vom Manager für alle Provider bereitgestellt.
7. **`play_card_callbacks` im Manager** — zentrale Callback-Instanz für `play_card`-Events, von allen Providern genutzt. Die Instanz wird in `playermpd/__init__.py` erstellt (mit MPD-Lock-Context) und via `set_play_card_callbacks()` in den Manager injiziert. Rückwärtskompatibilität: `from components.playermpd import play_card_callbacks` funktioniert weiterhin.
8. **Registrierung unter vorhandenen Plugin-Package-Namen** — Provider registrieren sich mit `plugs.register(instance, package='<loaded_package>', name='provider')`. Das Package muss via `plugs.load()` geladen worden sein.
9. **`@plugs.tag` auf allen RPC-callable Methods** — alle Methoden der Provider-Klassen, die via RPC aufrufbar sein sollen, müssen mit `@plugs.tag` dekoriert werden (Anforderung von `plugs.dereference()`).
10. **Einheitlicher `_last_played_folder` State** — `PlayerMPD.play_card()` und `PlayerMPD.play_folder()` lesen/schreiben `get_manager().get_last_played_folder()` / `set_last_played_folder()` (statt `self.music_player_status['player_status']['last_played_folder']`), damit alias-basierte und provider-basierte Karten einen gemeinsamen Second-Swipe-State teilen.

## Voraussetzung: PlayCardState-Extraktion

Der `MediaProviderManager` (ein Core-Paket) benötigt Zugriff auf `PlayCardState`
(für `get_play_card_state_first()`/`get_play_card_state_second()`).
Ein direkter Import aus `components.playermpd.playcontentcallback` würde gegen die
Schichtarchitektur verstoßen (Core importiert Component).

**Lösung (Teil dieses Milestones):** `PlayCardState` wird aus `components/playermpd/playcontentcallback.py`
nach `jukebox/callingback.py` extrahiert. Beide Module importieren von dort.

### Geändert: `src/jukebox/jukebox/callingback.py`

```python
# Am Ende der Datei hinzufügen:
from enum import Enum


class PlayCardState(Enum):
    """States for play_card callbacks"""
    firstSwipe = 1
    secondSwipe = 2
```

### Geändert: `src/jukebox/components/playermpd/playcontentcallback.py`

```python
# Alt:
# class PlayCardState(Enum):
#     firstSwipe = 0,
#     secondSwipe = 1

# Neu:
from jukebox.callingback import PlayCardState  # noqa: F401 (re-export für Abwärtskompatibilität)
```

> **Hinweis:** Der Re-Export erhält die Abwärtskompatibilität für bestehende Importe
> `from components.playermpd.playcontentcallback import PlayCardState`.

**Test:** `test/callingback/test_playcardstate.py` (siehe unten)

## Scope

- Neues Package `src/jukebox/jukebox/mediaprovider/`
- Abstract Base Class (`abc.ABC`) mit allen relevanten Methoden
- `MediaProviderManager` als Modul-Singleton (Factory-Funktion)
- Registrierung und Provider-Auswahl
- Second-Swipe-Logik in `play_card()` inkl. globalem `_last_played_folder`
- Zentrale `play_card_callbacks`-Instanz (via Injection aus `playermpd`)
- **Interne URI-Scheme** — `{provider}:{content_type}:{identifier}` für Content-Addressing (adopted from PR #2164)
- **PlayerStatus-Pattern** — zentralisiertes Status-Update mit ZeroMQ-Publish (adopted from PR #2164)
- **`PlayCardState`-Extraktion** — Enum aus `components/playermpd` nach `jukebox.callingback` verschieben

## Interne URI-Scheme (Adopted from PR #2164)

**Adopted from PR #2164:** Das `MediaProvider`-Interface verwendet intern ein URI-Schema
der Form `{provider}:{content_type}:{identifier}` für Content-Addressing. Dieses Schema
ist **ausschließlich intern** zwischen `MediaProviderManager`/`PlayerCtrl` und den
konkreten Provider-Implementierungen sichtbar.

**Benutzersichtbar** (in `cards.yaml`) bleibt das `provider:`/`value:`-Feld — die URI
wird von `decode_card_command()` (Milestone 5) automatisch generiert.

```
Interne URI-Struktur:
  {provider}:{content_type}:{identifier}

Beispiele:
  mpd:folder:path/to/album          → MPD, Ordner relativ zur Music-Library
  mpd:file:path/to/song.mp3         → MPD, einzelne Datei
  mpd:album:Feuerwehr:albumartist:Benjamin → MPD, Album-Suche
  jellyfin:item:folder_id_123       → Jellyfin, Item-ID
  jellyfin:track:track_id_456       → Jellyfin, einzelner Track
  smb:folder:music:/Album           → SMB, Share+Ordner
  smb:file:music:/song.mp3          → SMB, einzelne Datei im Share

Routing-Logik (in MediaProviderManager):
  1. URI parsen → provider_name, content_type, identifier
  2. Provider via provider_name auflösen
  3. Content-Typ-spezifische Methode aufrufen (play_folder, play_single, play_album)
```

**Vorteile der URI-Scheme (aus PR #2164):**
- Einheitliches, parsebares Format für alle Content-Typen über alle Provider hinweg
- Backend-Typ und Content-Typ sind explizit im URI codiert — kein implizites Wissen nötig
- Neue Backends erweitern nur den `{provider}`-Präfix (z.B. `spotify:track:id`)
- Routing vom Benutzer-Interface (`cards.yaml`) ist entkoppelt vom internen URI-Format
- MPD-spezifische `_flavors`-Map aus PR #2164 kann als Content-Type-Resolver adaptiert werden

## PlayerStatus Pattern (Adopted from PR #2164)

**Adopted from PR #2164:** Das Status-Propagation-Pattern wird vereinheitlicht.
`PlayerStatus` aus PR #2164 (`components/player/core/player_status.py`) dient als
Vorbild für ein zentralisiertes Status-Update mit automatischem ZeroMQ-Publish.

```python
# In jukebox/mediaprovider/playerstatus.py (Core-Utility)
class PlayerStatus:
    """Centralized player status with automatic ZeroMQ publishing."""

    STATUS_TEMPLATE = {
        'album': '', 'albumartist': '', 'artist': '',
        'coverArt': '', 'duration': 0, 'elapsed': 0,
        'file': '', 'player': '', 'playing': False,
        'shuffle': False, 'repeat': 0, 'title': '', 'trackid': '',
    }

    def __init__(self):
        self._player_status = dict(self.STATUS_TEMPLATE)

    def update(self, **kwargs):
        """Update status fields and publish changes."""
        for key, value in kwargs.items():
            if key in self.STATUS_TEMPLATE:
                self._player_status[key] = value
        self.publish()

    def publish(self):
        """Publish current status via ZeroMQ."""
        publishing.get_publisher().send('player_status', self._player_status)

    @property
    def status(self) -> dict:
        return self._player_status
```

**Integration:** Der `PlayerStatus` wird in `playermpd/__init__.py` instanziiert und
via `MediaProviderManager` für alle Provider bereitgestellt (analog zu `play_card_callbacks`).

## Second-Swipe-Logik

Die Second-Swipe-Erkennung lebt in der **Basisklasse `MediaProvider.play_card()`** und wird von allen Providern geerbt. `MpdMediaProvider` überschreibt diese Methode NICHT, sondern verwendet die geerbte Implementierung.

```python
def play_card(self, folder: str, recursive: bool = False):
    """
    Second swipe for ALL providers is handled here in the base class.
    MpdMediaProvider does NOT override this method.
    
    Uses globally-shared _last_played_folder from the Manager.
    Uses globally-shared _second_swipe_action from the Manager.
    Fires globally-shared play_card_callbacks.
    """
    from jukebox.mediaprovider import get_manager
    mgr = get_manager()
    
    last_played = mgr.get_last_played_folder()
    is_second_swipe = (last_played == folder)
    
    mgr.set_last_played_folder(folder)
    mgr.persist_last_played_folder()  # Writes to music_player_status.json
    
    swipe_action = mgr.get_second_swipe_action()
    
    # Fire callbacks
    callback_state = (mgr.get_play_card_state_second() if is_second_swipe
                      else mgr.get_play_card_state_first())
    mgr.get_play_card_callbacks().run_callbacks(folder, callback_state)
    
    if is_second_swipe and swipe_action:
        swipe_action()
    else:
        self.play_folder(folder, recursive)
```

### Globale vs. per-Provider-Persistierung

`_last_played_folder` wird **global** (nicht pro Provider) verwaltet, da immer nur eine Karte "zuletzt" gespielt wurde:
- Karte "Album A" via MPD → `_last_played_folder = "Album A"`
- Karte "Album A" via Jellyfin → second swipe erkannt (gleicher Wert!)
- Karte "Album B" via MPD → first swipe (Wert geändert)

Die Persistierung erfolgt über das bestehende `music_player_status.json` (verwendet `PlayerMPD`'s `nvm.load()`/`nvm.save()`-Mechanismus).

### Globale `second_swipe_action`

Die Second-Swipe-Aktion wird **einmalig** beim Start aus der `playermpd`-Konfiguration gelesen und vom `MediaProviderManager` für alle Provider bereitgestellt. In `playermpd/__init__.py`'s `initialize()`:

```python
get_manager().set_second_swipe_action(player_ctrl.second_swipe_action)
```

Dadurch verhalten sich alle Provider identisch bei Second-Swipe. Der bestehende `playermpd.second_swipe_action`-Config-Key bleibt die Autorisierungsquelle. Keine Duplizierung der Config-Logik.

### Zentrale `play_card_callbacks`

Die `PlayContentCallbacks[PlayCardState]`-Instanz wird weiterhin in `playermpd/__init__.py` erstellt (mit MPD-Lock-Context). Nach der Erstellung wird sie via `set_play_card_callbacks()` in den `MediaProviderManager` injiziert. Andere Provider greifen via `get_manager().get_play_card_callbacks()` darauf zu.

Rückwärtskompatibilität: `from components.playermpd import play_card_callbacks` funktioniert weiterhin, da die Variable in `playermpd/__init__.py` erhalten bleibt.

### Einheitlicher `_last_played_folder` State

`PlayerMPD.play_card()` und `PlayerMPD.play_folder()` werden minimal geändert, um den `_last_played_folder` über den `MediaProviderManager` zu lesen/schreiben (statt über `self.music_player_status['player_status']['last_played_folder']` direkt). Dadurch teilen sich alias-basierte und provider-basierte Karten denselben State:

- `PlayerMPD.play_card()` liest `last_played` via `get_manager().get_last_played_folder()`
- `PlayerMPD.play_folder()` schreibt via `get_manager().set_last_played_folder(folder)`

## Wichtig: Provider-Registrierung

Provider registrieren sich **unter ihrem eigenen, bereits geladenen Plugin-Package-Namen**. Dies ist notwendig, da `plugs.register(obj, package='...')` nur funktioniert, wenn das Package bereits via `plugs.load()` in `_PLUGINS` eingetragen ist.

```python
# MPD-Provider: 'player' wurde via load_all_named geladen
plugs.register(mpd_provider, package='player', name='provider')
# → RPC: player.provider.play_folder()

# Jellyfin-Provider: 'jellyfin' wurde via load_all_unnamed geladen
plugs.register(jellyfin_provider, package='jellyfin', name='provider')
# → RPC: jellyfin.provider.play_folder()
```

## `@plugs.tag` auf allen RPC-callable Methods

`plugs.dereference()` prüft `getattr(func, 'plugs_callable', False)`. Jede Methode einer als Plugin-Instanz registrierten Klasse, die via RPC aufrufbar sein soll, **muss** mit `@plugs.tag` dekoriert werden. Dies gilt für alle konkreten Provider-Implementierungen (`MpdMediaProvider`, `JellyfinMediaProvider`, `SmbMediaProvider`). Das Tagging erfolgt in den konkreten Subklassen, nicht in der abstrakten Basisklasse (da ABC-Methoden `@abstractmethod` haben und die konkreten Überschreibungen getaggt werden müssen).

## Dateien

### Neu: `src/jukebox/jukebox/mediaprovider/__init__.py`

```python
"""
MediaProvider — Abstract Base Class for media source providers.

Usage:
    from jukebox.mediaprovider import MediaProvider, get_manager

    class MyProvider(MediaProvider):
        ...
"""

from abc import ABC, abstractmethod
from typing import Optional
import jukebox.plugs as plugs


class MediaProvider(ABC):
    """
    Abstract base class for all media source providers.

    Implementations: MpdMediaProvider (core), JellyfinMediaProvider (external plugin), etc.
    Each provider is implemented as a plugin under src/jukebox/components/.
    Each provider registers itself with plugs.register(instance, package='<package>', name='provider').
    
    Second-swipe logic is implemented in play_card() and inherited by ALL providers.
    MpdMediaProvider does NOT override play_card() — it inherits the base implementation.
    The _last_played_folder is managed globally by the MediaProviderManager (not per-provider).
    The _second_swipe_action is resolved once from playermpd config and stored in the Manager.
    play_card_callbacks are centralized in the Manager and fired for all providers.
    
    IMPORTANT: All methods of concrete subclasses that shall be RPC-callable must be
    decorated with @plugs.tag. See plugs.dereference() for the requirement.
    """

    def __init__(self):
        # No per-provider attributes for second-swipe tracking
        # Everything is managed centrally by MediaProviderManager
        pass

    # --- Lifecycle ---
    @abstractmethod
    def initialize(self):
        """Initialize the provider (connect, authenticate, etc.)"""
        pass

    @abstractmethod
    def shutdown(self):
        """Shutdown the provider gracefully"""
        pass

    # --- Second Swipe Logic (implementiert in Basisklasse, von allen geerbt) ---
    @plugs.tag
    def play_card(self, folder: str, recursive: bool = False):
        """
        Play content triggered by RFID card.
        
        Second swipe detection is implemented here (inherited by ALL providers).
        Uses globally-shared _last_played_folder and _second_swipe_action
        from the MediaProviderManager. Fires centralized play_card_callbacks.
        
        MpdMediaProvider MUST NOT override this method.
        External providers (Jellyfin, SMB) inherit this method directly.
        
        Important: This does not check provider identity — it checks only the
        folder value. This means: if card A (MPD, "folder1") is played, then
        card B (Jellyfin, "folder1") would be detected as second swipe BECAUSE
        the folder value matches. This is intentional: the second swipe is
        about the content, not the provider.
        
        Design principle: The 'folder' parameter is **provider-opaque**.
        Each provider interprets it according to its own addressing scheme:
        - MPD: relative path within the local music library
        - Jellyfin: Jellyfin item ID (e.g., "folder_id_123")
        - SMB: remote path on the share (e.g., "/Music/Album")
        It is each provider's responsibility to interpret and resolve 'folder'
        into actual media content in its play_folder() implementation.
        """
        from jukebox.mediaprovider import get_manager
        mgr = get_manager()
        
        last_played = mgr.get_last_played_folder()
        is_second_swipe = (last_played == folder)
        
        mgr.set_last_played_folder(folder)
        mgr.persist_last_played_folder()
        
        swipe_action = mgr.get_second_swipe_action()
        
        # Fire callbacks (same for all providers)
        state = (mgr.get_play_card_state_second() if is_second_swipe
                 else mgr.get_play_card_state_first())
        mgr.get_play_card_callbacks().run_callbacks(folder, state)
        
        if is_second_swipe and swipe_action:
            swipe_action()
        else:
            self.play_folder(folder, recursive)

    # --- Status ---
    @abstractmethod
    def status(self) -> dict:
        """Get current player status"""
        pass

    @abstractmethod
    def get_current_song(self) -> Optional[dict]:
        """Get currently playing song metadata"""
        pass

    # --- Playback Control ---
    @abstractmethod
    def play(self):
        """Resume playback"""
        pass

    @abstractmethod
    def stop(self):
        """Stop playback"""
        pass

    @abstractmethod
    def pause(self, state: int = 1):
        """Pause or resume (1=pause, 0=resume)"""
        pass

    @abstractmethod
    def toggle(self):
        """Toggle pause/play"""
        pass

    @abstractmethod
    def next(self):
        """Next track"""
        pass

    @abstractmethod
    def prev(self):
        """Previous track"""
        pass

    @abstractmethod
    def seek(self, new_time: float):
        """Seek to position in seconds"""
        pass

    @abstractmethod
    def rewind(self):
        """Restart current playlist from first track"""
        pass

    # --- Playlist & Content ---
    @abstractmethod
    def play_folder(self, folder: str, recursive: bool = False):
        """Play content from a folder/path identifier"""
        pass

    @abstractmethod
    def play_single(self, song_url: str):
        """Play a single track by its URL/identifier"""
        pass

    @abstractmethod
    def play_album(self, albumartist: str, album: str):
        """Play an album"""
        pass

    @abstractmethod
    def clear_playlist(self):
        """
        Clear the current playlist without starting playback.

        Used by external providers (Jellyfin, SMB) to clear the playlist
        once before adding multiple tracks via add_to_playlist().
        """
        pass

    @abstractmethod
    def add_to_playlist(self, song_url: str):
        """
        Add a single track to the current playlist without clearing or playing.

        Used by external providers to build a playlist incrementally.
        After adding all tracks, call play() to start playback.

        :param song_url: URL or filesystem path of the track to add
        """
        pass

    @abstractmethod
    def playlistinfo(self) -> list:
        """Get current playlist"""
        pass

    @abstractmethod
    def list_albums(self) -> list:
        """List all available albums"""
        pass

    @abstractmethod
    def get_folder_content(self, folder: str) -> list:
        """List content of a folder/directory"""
        pass

    @abstractmethod
    def list_all_dirs(self) -> list:
        """List all top-level directories/collections"""
        pass

    # --- Cover Art ---
    @abstractmethod
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        """Get cover art for a single track. Returns filename or URL to cached image."""
        pass

    @abstractmethod
    def get_album_coverart(self, albumartist: str, album: str) -> Optional[str]:
        """Get cover art for an album"""
        pass

    # --- Library Management ---
    @abstractmethod
    def update(self):
        """Trigger library update"""
        pass

    @abstractmethod
    def update_wait(self):
        """Trigger library update and wait for completion"""
        pass

    # --- Provider Info ---
    @abstractmethod
    def get_player_type_and_version(self) -> str:
        """Get provider identifier and version string"""
        pass
```

### Neu: `src/jukebox/jukebox/mediaprovider/manager.py`

```python
"""
MediaProviderManager — Module-Singleton für Provider-Registrierung und -Auflösung.

Zentralisiert:
- Provider-Registrierung und -Auflösung
- Globalen `_last_played_folder` (persistiert via music_player_status.json)
- Globale `_second_swipe_action` (von PlayerMPD injiziert)
- Zentrale `play_card_callbacks`-Instanz (von playermpd injiziert, für alle Provider)

Konsistent mit bestehenden Patterns:
- nv_manager() → gibt Singleton-Instanz zurück
- get_jukebox_daemon() → Builder-Pattern

Usage:
    from jukebox.mediaprovider import get_manager

    # In @initialize (playermpd):
    manager = get_manager()
    manager.register_provider('mpd', mpd_provider)
    manager.set_default('mpd')
    manager.set_second_swipe_action(player_ctrl.second_swipe_action)
    manager.set_play_card_callbacks(play_card_callbacks)  # Inject after creation

    # Routing:
    provider = get_manager().resolve('jellyfin')
    provider = get_manager().resolve()  # → Default-Provider (MPD)

    # RPC für list_providers():
    get_manager().list_providers()  # → ['mpd', 'jellyfin']
"""

import logging
from typing import Optional, Callable
from . import MediaProvider

logger = logging.getLogger('jb.mediaprovider.manager')


class MediaProviderManager:
    """
    Manages multiple media providers simultaneously.
    
    - Providers register themselves during plugin @initialize.
    - MPD is always the default provider (audio backend).
    - Supports routing: each RFID card can specify a different provider.
    - Centralizes _last_played_folder and _second_swipe_action globally.
    - Centralizes play_card_callbacks (injected from playermpd after creation).
    """

    def __init__(self):
        self._providers: dict[str, MediaProvider] = {}
        self._default_provider: Optional[str] = None
        
        # Globale Second-Swipe-Attribute (von PlayerMPD injiziert)
        self._last_played_folder: str = ''
        self._second_swipe_action: Optional[Callable] = None
        
        # Persist-Callback (von playermpd injiziert, konsistent mit anderen Injections)
        self._persist_callback: Optional[Callable[[str], None]] = None
        
        # Zentrale play_card_callbacks-Instanz (von playermpd injiziert)
        self._play_card_callbacks = None
        self._play_card_state_first = None
        self._play_card_state_second = None

    # --- Provider-Registrierung ---

    def register_provider(self, name: str, provider: MediaProvider):
        """Register a media provider under a given name"""
        if name in self._providers:
            logger.warning(f"Provider '{name}' already registered. Overwriting.")
        self._providers[name] = provider
        logger.info(f"Provider '{name}' registered")

    def set_default(self, name: str):
        """Set the default provider (for RPC fallback).
        
        Raises KeyError if not registered.
        MPD is always the default provider."""
        if name not in self._providers:
            raise KeyError(f"Provider '{name}' not registered. "
                           f"Available: {list(self._providers.keys())}")
        self._default_provider = name
        logger.info(f"Default provider set to '{name}'")

    def get_default(self) -> Optional[str]:
        """Get the name of the default provider."""
        return self._default_provider

    def resolve(self, provider_name: str = None) -> MediaProvider:
        """
        Resolve a provider by name. Falls back to default if name is None.
        
        Raises RuntimeError if no provider is found.
        """
        if provider_name is None:
            provider_name = self._default_provider
        if provider_name is None:
            raise RuntimeError("No media provider configured and no default set")
        if provider_name not in self._providers:
            raise KeyError(
                f"Provider '{provider_name}' not registered. "
                f"Available: {list(self._providers.keys())}"
            )
        return self._providers[provider_name]

    def get_provider(self, name: str) -> MediaProvider:
        """Get a provider by name. Raises KeyError if not found."""
        return self.resolve(name)

    def list_providers(self) -> list[str]:
        """List all registered provider names."""
        return list(self._providers.keys())

    # --- Globale Second-Swipe-Attribute ---

    def get_last_played_folder(self) -> str:
        """Get the globally-persisted last played folder value."""
        return self._last_played_folder

    def set_last_played_folder(self, folder: str):
        """Set the globally-persisted last played folder value."""
        self._last_played_folder = folder

    def set_persist_callback(self, callback: Callable[[str], None]):
        """
        Set a callback for persisting _last_played_folder.
        
        Injected by playermpd/__init__.py alongside play_card_callbacks
        and second_swipe_action. The callback is responsible for both
        updating the music_player_status dict AND calling save_to_json().
        
        This injection pattern keeps the Manager module generic (no
        late imports from components.playermpd).
        
        :param callback: Callable that receives (folder: str) and persists it.
        """
        self._persist_callback = callback

    def persist_last_played_folder(self):
        """
        Persist the current _last_played_folder using the injected callback.
        
        Falls back gracefully if the persist callback hasn't been injected yet
        (e.g., during early startup or testing without PlayerMPD).
        """
        if self._persist_callback is not None:
            self._persist_callback(self._last_played_folder)
        else:
            logger.debug("Persist callback not yet injected. Skipping persist.")

    def set_second_swipe_action(self, action: Optional[Callable]):
        """
        Set the globally-shared second swipe action.
        
        Called by playermpd/__init__.py's @initialize with the already-resolved
        action from PlayerMPD.decode_2nd_swipe_option().
        
        :param action: Callable or None (disables second-swipe)
        """
        self._second_swipe_action = action

    def get_second_swipe_action(self) -> Optional[Callable]:
        """Get the globally-shared second swipe action callable."""
        return self._second_swipe_action

    # --- Zentrale Callbacks ---

    def set_play_card_callbacks(self, callbacks):
        """
        Set the globally-shared PlayContentCallbacks instance.
        
        Called by playermpd/__init__.py after the instance is created
        (with MPD lock context). All providers access this via
        get_play_card_callbacks().
        
        Uses PlayCardState from jukebox.callingback (not from components.playermpd)
        to avoid a Core→Component dependency. See Milestone 0 prerequisites.
        """
        from jukebox.callingback import PlayCardState
        self._play_card_callbacks = callbacks
        self._play_card_state_first = PlayCardState.firstSwipe
        self._play_card_state_second = PlayCardState.secondSwipe

    def get_play_card_callbacks(self):
        """Get the globally-shared PlayContentCallbacks instance."""
        if self._play_card_callbacks is None:
            raise RuntimeError("play_card_callbacks not yet injected. "
                               "PlayerMPD must be initialized first.")
        return self._play_card_callbacks

    def get_play_card_state_first(self):
        """Get PlayCardState.firstSwipe enum value."""
        if self._play_card_state_first is None:
            raise RuntimeError("play_card_callbacks not yet injected.")
        return self._play_card_state_first

    def get_play_card_state_second(self):
        """Get PlayCardState.secondSwipe enum value."""
        if self._play_card_state_second is None:
            raise RuntimeError("play_card_callbacks not yet injected.")
        return self._play_card_state_second


# ------------------------------------------------------------------
# Module-Singleton (konsistent mit nv_manager(), get_jukebox_daemon())
# ------------------------------------------------------------------

_manager_instance: Optional[MediaProviderManager] = None


def get_manager() -> MediaProviderManager:
    """
    Factory-Funktion für den MediaProviderManager-Singleton.
    
    Usage:
        manager = get_manager()
        manager.register_provider('mpd', mpd_provider)
        manager.resolve('jellyfin').play_folder("id123")
    """
    global _manager_instance
    if _manager_instance is None:
        _manager_instance = MediaProviderManager()
    return _manager_instance
```

## Änderungen an bestehenden Dateien

### Geändert: `playermpd/__init__.py` — Callbacks injizieren

Die `play_card_callbacks`-Instanz wird **weiterhin** in `playermpd/__init__.py` erstellt. Nach der Erstellung wird sie via `set_play_card_callbacks()` in den Manager injiziert, sodass alle Provider darauf zugreifen können:

```python
@plugs.initialize
def initialize():
    global player_ctrl
    player_ctrl = PlayerMPD()
    plugs.register(player_ctrl, name='ctrl')
    
    # PlayContentCallbacks wird wie bisher erstellt (mit MPD-Lock-Context)
    global play_card_callbacks
    play_card_callbacks = PlayContentCallbacks[PlayCardState]('play_card_callbacks', logger, context=player_ctrl.mpd_lock)
    
    # ==== NEU: Callbacks, persist + second_swipe_action in Manager injizieren ====
    from jukebox.mediaprovider import get_manager
    get_manager().set_play_card_callbacks(play_card_callbacks)
    get_manager().set_second_swipe_action(player_ctrl.second_swipe_action)
    # Persist-Callback: synchronisiert _last_played_folder ins music_player_status dict
    # und persistiert via NvManager (konsistent mit PlayerMPD.play_folder())
    def _persist_to_music_player_status(folder: str):
        if 'player_status' not in player_ctrl.music_player_status:
            player_ctrl.music_player_status['player_status'] = {}
        player_ctrl.music_player_status['player_status']['last_played_folder'] = folder
        player_ctrl.music_player_status.save_to_json()
    get_manager().set_persist_callback(_persist_to_music_player_status)
    
    # MPD als MediaProvider registrieren
    from .mpd_provider import MpdMediaProvider
    mpd_provider = MpdMediaProvider()
    mpd_provider._player = player_ctrl
    mpd_provider.initialize()
    get_manager().register_provider('mpd', mpd_provider)
    get_manager().set_default('mpd')
    plugs.register(mpd_provider, package='player', name='provider')
    
    # ... restlicher Code (library_update, check_user_rights) ...

### Geändert: `PlayerMPD.play_card()` und `play_folder()` — einheitlicher `_last_played_folder`

Minimale Änderungen, um den `_last_played_folder` über den Manager zu lesen/schreiben:

```python
@plugs.tag
def play_card(self, folder: str, recursive: bool = False):
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
        self.play_folder(folder, recursive)
```

In `play_folder()`:
```python
@plugs.tag
def play_folder(self, folder: str, recursive: bool = False) -> None:
    with self.mpd_lock:
        # ... playlist generation ...
        get_manager().set_last_played_folder(folder)
        # ... rest of method ...
```

### Geändert: `PlayerMPD.get_current_song()` — ungenutzten `param` entfernen

```python
@plugs.tag
def get_current_song(self) -> Optional[dict]:
    return self.mpd_status
```

Der ungenutzte `param`-Parameter wird entfernt. Die Methode gab immer nur `self.mpd_status` zurück. Dies macht die Signatur konsistent mit dem `MediaProvider`-Interface.

## `__all__` in `__init__.py`

```python
__all__ = ['MediaProvider', 'get_manager']
```

## Tests

### Neu: `test/mediaprovider/test_mediaprovider_manager.py`

- `get_manager()` gibt immer dieselbe Instanz zurück (Singleton)
- Registrierung mehrerer Mock-Provider
- `resolve('mpd')` gibt den MPD-Provider zurück
- `resolve()` ohne Argument gibt den Default-Provider zurück
- `resolve('unbekannt')` wirft KeyError mit hilfreicher Fehlermeldung
- `set_default()` mit gültigem/ungültigem Namen
- Mehrere Provider können gleichzeitig registriert sein
- `list_providers()` zeigt alle registrierten Namen
- `set_last_played_folder()`/`get_last_played_folder()` roundtrip
- `set_second_swipe_action()`/`get_second_swipe_action()` roundtrip
- `set_play_card_callbacks()` → `get_play_card_callbacks()` liefert gleiche Instanz
- `get_play_card_callbacks()` vor `set_play_card_callbacks()` wirft `RuntimeError`

### Neu: `test/mediaprovider/test_mediaprovider_base.py`

- `play_card()` mit gleichem folder → second swipe erkannt (globale `_last_played_folder` im Manager)
- `play_card()` mit anderem folder → first swipe (delegiert an `play_folder()`)
- `play_card()` ohne `_second_swipe_action` → immer first swipe (auch bei gleichem folder)
- `play_card()` setzt `_last_played_folder` im Manager nach jedem Aufruf
- `play_card()` persistiert `_last_played_folder` nach jedem Aufruf
- `play_card()` feuert `play_card_callbacks.run_callbacks()` mit korrektem State
- Aufruf von `play_card()` über verschiedene Provider-Instanzen teilt globalen State
- Das geerbte `play_card()` hat `plugs_callable = True` bei RPC-Dispatch über `plugs.dereference('jellyfin', 'provider', 'play_card')`

## Akzeptanzkriterien

- [ ] `MediaProvider` kann importiert werden: `from jukebox.mediaprovider import MediaProvider`
- [ ] `get_manager()` kann importiert werden: `from jukebox.mediaprovider import get_manager`
- [ ] `get_manager()` gibt Singleton-Instanz zurück
- [ ] `play_card()` implementiert Second-Swipe-Erkennung in der Basisklasse
- [ ] `play_card()` speichert `_last_played_folder` im Manager (global, nicht per-Provider)
- [ ] `play_card()` persistiert `_last_played_folder` via `music_player_status.json`
- [ ] `play_card()` feuert `play_card_callbacks` (zentral, für alle Provider)
- [ ] `play_card()` delegiert an `play_folder()` bei erstem Swipe
- [ ] `play_card()` ruft `_second_swipe_action` bei zweitem Swipe
- [ ] `play_card_callbacks` wird in `playermpd/__init__.py` erstellt und in Manager injiziert
- [ ] `get_play_card_callbacks()` vor `set_play_card_callbacks()` wirft `RuntimeError`
- [ ] `from components.playermpd import play_card_callbacks` funktioniert weiterhin
- [ ] Mehrere Provider können gleichzeitig registriert sein
- [ ] `resolve('name')` wählt den korrekten Provider aus
- [ ] `resolve()` ohne Argument nutzt den Default-Provider
- [ ] Das geerbte `play_card()` hat `plugs_callable = True` und ist via `plugs.dereference('{provider}', 'provider', 'play_card')` aufrufbar — getestet für alle Provider (MPD, Jellyfin, SMB)
- [ ] `player.ctrl.*` RPC bleibt unverändert (Rückwärtskompatibilität)
- [ ] `daemon.py`: expliziter `import jukebox.mediaprovider` vor Plugin-Loading hinzugefügt
- [ ] `plugs.py` bleibt unverändert
- [ ] Alle bestehenden Tests laufen weiterhin
