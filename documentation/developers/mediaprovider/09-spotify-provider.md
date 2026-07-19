# Milestone 9 — Optional: Spotify MediaProvider

## Status: **Optional** — Requires M8 (Mopidy Migration)

Dieser Milestone setzt voraus, dass Mopidy (Milestone 8) als Audio-Backend
installiert ist, da MPD kein Spotify-Protokoll unterstützt. Mit Mopidy +
`mopidy-spotify` ist Spotify vollständig in das MediaProvider-System integrierbar.

## Ziel

`SpotifyMediaProvider` implementieren, der die `MediaProvider`-Schnittstelle erfüllt
und Spotify-Inhalte (Alben, Playlists, Tracks) über Mopidy's Spotify-Extension
bereitstellt. Der Provider folgt dem gleichen Muster wie Jellyfin (M4) und SMB (M6).

**Registration:** Der Spotify-Provider wird als `spotify.provider` registriert:
- `spotify.provider.play_folder("spotify:album:xxx")`
- `spotify.provider.play_single("spotify:track:xxx")`
- `spotify.provider.list_albums()`
- `spotify.provider.search("query")`

## Abhängigkeiten

- Milestone 8 (Mopidy Migration) — Mopidy + mopidy-spotify als Audio-Backend
- Milestone 1 (MediaProvider Interface)
- Milestone 2 (MPD-Adapter) — Mopidy spricht MPD-Protokoll, verwendet via `MpdMediaProvider`
- Milestone 5 (Card Routing) — für `provider: spotify` in `cards.yaml`
- Spotify Premium Account + Spotify API Credentials (Client ID/Secret, see below)

## Wichtige Design-Entscheidungen

1. **Second-Swipe-Logik über Basisklasse** — `SpotifyMediaProvider` überschreibt
   `play_card()` NICHT. Die geerbte Implementierung aus `MediaProvider` wird
   verwendet.

2. **Mopidy als MPD-kompatibles Backend** — `SpotifyMediaProvider` delegiert
   Playback an `MpdMediaProvider` (der tatsächlich mit Mopidy kommuniziert).
   Mopidy's `mopidy-spotify`-Extension behandelt alle Spotify-Protokolldetails.

3. **Spotify-URIs als `value`** — In `cards.yaml` wird `value` mit Spotify-URIs
   befüllt: `spotify:album:xxx`, `spotify:playlist:xxx`, `spotify:track:xxx`.

4. **Secrets via `retrieve()` aus `jukebox.secrets`** — Client ID und Client Secret werden via
   `retrieve()` (Milestone 0a) aus Umgebungsvariablen, `secrets.yaml` oder `secrets.conf` geladen.

5. **Eigener top-level Config-Key** — Konfiguration unter `spotify:` (konsistent
   mit `jellyfin:`, `smb:`).

6. **Config-Validierung** — Fehlende Konfiguration (Client ID, Secret) wird
   erkannt und mit aussagekräftigen Fehlermeldungen gemeldet.

7. **Alle RPC-Methoden mit `@plugs.tag`** — analog zu `PlayerMPD`'s Methoden.

## Second-Swipe-Verhalten für Spotify

Da `SpotifyMediaProvider` `play_card()` nicht überschreibt, gilt:

```
spotify.provider.play_card("spotify:album:xxx")
  → MediaProvider.play_card() (geerbt von Basisklasse)
    → Globales _last_played_folder Check (Manager)
    → Wenn gleicher Wert und second_swipe_action gesetzt:
      → second_swipe_action() (z.B. toggle, play)
    → Sonst: SpotifyMediaProvider.play_folder("spotify:album:xxx")
      → Mopidy löst Album-Tracks auf
      → MPD-kompatibles Playback via Mopidy
```

## Scope

- `SpotifyMediaProvider` in `spotify_provider.py`
- Plugin-Lifecycle in `spotify/__init__.py`
- Das Plugin registriert sich selbst im `MediaProviderManager`
- Eigenes RPC-Package: `spotify.provider.*`
- Search-Unterstützung (Spotify-spezifisch, nicht in `MediaProvider` ABC)

## Konzept

```
┌──────────────────────────────────────────────────────────────────┐
│                    SpotifyMediaProvider                           │
│                                                                  │
│  RFID Card → play_card("spotify:album:xxx") (GEERBT)            │
│       ↓                     (Second-Swipe-Prüfung im Manager)    │
│  Mopidy (via MpdMediaProvider):                                  │
│    • lsinfo("spotify:album:xxx") → Liste von Tracks              │
│    • addid("spotify:track:xxx") für jeden Track                  │
│    • play()                                                      │
│       ↓                                                          │
│  Mopidy's Spotify Extension:                                     │
│    • Authentifizierung via Client ID/Secret                      │
│    • Stream-Auflösung via Spotify Web API                        │
│    • Audio-Wiedergabe via Mopidy → PulseAudio                   │
└──────────────────────────────────────────────────────────────────┘
```

## Konfiguration

```yaml
# jukebox.yaml
spotify:
  # Client ID und Client Secret werden bevorzugt aus secrets.conf gelesen:
  # SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET
  # Fallback: direkt hier eintragen (nicht empfohlen)
  client_id: ""
  client_secret: ""
  # Cache für Album-Cover (Spotify liefert URLs, optional lokal cachen)
  cover_cache_dir: ~/RPi-Jukebox-RFID/shared/artifacts/spotify_cache
```

Aktivierung in `modules.others`:

```yaml
modules:
  others:
    - spotify   # ← Wichtig: OHNE 'components.'-Präfix
```

## Dateien

### Neu: `src/jukebox/components/spotify/__init__.py`

```python
"""
Spotify Media Provider Plugin

Second-Swipe-Logik: Wird von der Basisklasse MediaProvider.play_card() geerbt.
    SpotifyMediaProvider überschreibt play_card() NICHT.
    Die globale second_swipe_action kommt aus playermpd.second_swipe_action (vom Manager).
    play_card_callbacks werden zentral über den Manager gefeuert.

Erfordert Mopidy mit mopidy-spotify Extension (Milestone 8).
"""

import logging
import jukebox.plugs as plugs
import jukebox.cfghandler
from jukebox.secrets import retrieve

logger = logging.getLogger('jb.spotify')
cfg = jukebox.cfghandler.get_handler('jukebox')

spotify_provider_instance = None


@plugs.initialize
def initialize():
    """
    Initialize Spotify provider.

    Requires Mopidy to be available as audio backend (speaks MPD protocol).
    Requires Spotify client credentials (via secrets.conf or jukebox.yaml).

    play_card() wird von der Basisklasse geerbt — keine eigene Implementierung nötig.
    Second-Swipe-Aktion wird vom Manager bereitgestellt (aus playermpd-Config).
    Callbacks werden zentral vom Manager gefeuert.
    """
    global spotify_provider_instance

    # Prüfen, ob Mopidy (MPD-kompatibel) als Audio-Backend verfügbar ist
    from jukebox.mediaprovider import get_manager
    try:
        mpd_provider = get_manager().get_provider('mpd')
    except KeyError:
        logger.error(
            "MPD/Mopidy provider not found. "
            "Spotify requires Mopidy with mopidy-spotify extension. "
            "See Milestone 8 (Mopidy Migration). Aborting."
        )
        return

    # Config-Validierung
    errors = []
    client_id = retrieve('spotify', 'client_id',
                         env_var='SPOTIFY_CLIENT_ID', default=None)
    client_secret = retrieve('spotify', 'client_secret',
                             env_var='SPOTIFY_CLIENT_SECRET', default=None)

    if not client_id:
        errors.append(
            "'spotify.client_id' is not set. "
            "Create a Spotify Developer app at https://developer.spotify.com/dashboard"
        )
    if not client_secret:
        errors.append("'spotify.client_secret' is not set")

    if errors:
        logger.error(
            "Spotify configuration incomplete:\n  " + "\n  ".join(errors)
        )
        return

    from .spotify_provider import SpotifyMediaProvider

    spotify_provider_instance = SpotifyMediaProvider(
        mpd_backend=mpd_provider,
        client_id=client_id,
        client_secret=client_secret,
    )
    spotify_provider_instance.initialize()

    get_manager().register_provider('spotify', spotify_provider_instance)

    # Spotify-Provider unter dem 'spotify'-Package registrieren
    plugs.register(spotify_provider_instance, package='spotify', name='provider')

    logger.info("Spotify Media Provider initialized and registered")


@plugs.finalize
def finalize():
    """Publish initial state after all plugins are loaded."""
    pass


@plugs.atexit
def atexit(**kwargs):
    """Shutdown Spotify provider gracefully."""
    global spotify_provider_instance
    if spotify_provider_instance is not None:
        spotify_provider_instance.shutdown()
        spotify_provider_instance = None
        logger.info("Spotify Media Provider shut down")
```

### Neu: `src/jukebox/components/spotify/spotify_provider.py`

```python
"""
Spotify MediaProvider — implementiert die MediaProvider-Schnittstelle.

RPC: Registriert als spotify.provider
    spotify.provider.play_folder("spotify:album:xxx")
    spotify.provider.play_single("spotify:track:xxx")
    spotify.provider.list_albums()
    spotify.provider.search("query")

Second-Swipe: Wird von der Basisklasse geerbt (MediaProvider.play_card()).
    SpotifyMediaProvider überschreibt play_card() NICHT.

Erfordert Mopidy mit mopidy-spotify Extension.
Mopidy spricht MPD-Protokoll → verwendet via MpdMediaProvider (python-mpd2).

IMPORTANT: All RPC-callable methods are decorated with @plugs.tag.
"""

import logging
from typing import Optional

import jukebox.cfghandler
import jukebox.plugs as plugs
from jukebox.mediaprovider import MediaProvider

logger = logging.getLogger('jb.spotify.provider')
cfg = jukebox.cfghandler.get_handler('jukebox')


class SpotifyMediaProvider(MediaProvider):
    """
    MediaProvider that uses Spotify as a media source via Mopidy.

    Inherits play_card() from MediaProvider base class for second-swipe logic.
    Mopidy (with mopidy-spotify) is used as the audio playback backend.
    Mopidy speaks the MPD protocol, so python-mpd2 works unchanged.

    Content addressing: Spotify URIs
    - spotify:album:xxx → play_folder()
    - spotify:playlist:xxx → play_folder()
    - spotify:track:xxx → play_single()
    - spotify:artist:xxx → list_albums()
    """

    def __init__(self, mpd_backend: MediaProvider,
                 client_id: str, client_secret: str):
        """
        :param mpd_backend: Mopidy as audio playback backend (via MPD protocol)
        :param client_id: Spotify API client ID
        :param client_secret: Spotify API client secret
        """
        super().__init__()
        self._mpd = mpd_backend
        self._client_id = client_id
        self._client_secret = client_secret
        self._cover_cache_dir: Optional[str] = None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def initialize(self):
        """
        Spotify authentication is handled by Mopidy's mopidy-spotify extension.

        Mopidy reads spotify.client_id and spotify.client_secret from
        mopidy.conf (set by the installer in Milestone 8).

        This method validates that the Mopidy backend is responsive and
        that Spotify URIs can be resolved.
        """
        cover_cache_dir = cfg.getn('spotify', 'cover_cache_dir', default=None)
        if cover_cache_dir:
            import os
            os.makedirs(os.path.expanduser(cover_cache_dir), exist_ok=True)
            self._cover_cache_dir = cover_cache_dir

        # Verify Spotify extension is loaded (optional check)
        try:
            status = self._mpd.status()
            logger.debug(f"Spotify backend status: {status}")
        except Exception as e:
            logger.warning(
                f"Could not verify Mopidy/Spotify status: {e}. "
                f"Ensure mopidy-spotify is installed and configured."
            )

        logger.info("SpotifyMediaProvider initialized")

    def shutdown(self):
        """Clean shutdown."""
        logger.info("SpotifyMediaProvider shut down")

    # ------------------------------------------------------------------
    # Playback
    # ------------------------------------------------------------------

    @plugs.tag
    def play_folder(self, folder: str, recursive: bool = False):
        """
        Play a Spotify album or playlist.

        'folder' is a Spotify URI:
        - spotify:album:xxx
        - spotify:playlist:xxx

        Mopidy resolves these URIs to individual tracks and adds them
        to the queue via the MPD protocol.
        """
        if not folder.startswith('spotify:'):
            logger.error(
                f"Invalid Spotify URI: '{folder}'. "
                f"Expected 'spotify:album:xxx' or 'spotify:playlist:xxx'"
            )
            return

        # Mopidy accepts spotify: URIs in find/addid
        # lsinfo on a spotify:album: URI returns the track listing
        try:
            tracks = self._mpd.playlistinfo_for_uri(folder)
        except Exception as e:
            logger.error(f"Could not resolve Spotify URI '{folder}': {e}")
            return

        if not tracks:
            logger.warning(f"No tracks found for Spotify URI: {folder}")
            return

        # Build playlist from Spotify URIs
        self._mpd.stop()
        self._mpd.clear_playlist()
        for track in tracks:
            uri = track.get('file') or track.get('uri', '')
            if uri:
                self._mpd.add_to_playlist(uri)

        self._mpd.play()
        logger.info(f"Playing {len(tracks)} tracks from {folder}")

    @plugs.tag
    def play_single(self, song_url: str):
        """
        Play a single Spotify track.

        :param song_url: Spotify URI (spotify:track:xxx)
        """
        if not song_url.startswith('spotify:track:'):
            logger.error(f"Expected spotify:track: URI, got: '{song_url}'")
            return

        self._mpd.stop()
        self._mpd.clear_playlist()
        self._mpd.add_to_playlist(song_url)
        self._mpd.play()
        logger.info(f"Playing Spotify track: {song_url}")

    @plugs.tag
    def play_album(self, albumartist: str, album: str):
        """
        Play an album by searching Spotify.

        Searches for 'albumartist album' and plays the first match.
        """
        results = self.search(f"{albumartist} {album}")
        albums = [r for r in results if r.get('type') == 'album']
        if albums:
            self.play_folder(albums[0]['uri'])
        else:
            logger.warning(
                f"Spotify album not found: '{album}' by '{albumartist}'"
            )

    # ------------------------------------------------------------------
    # Status & Navigation (delegiert an Mopidy via MPD-Protokoll)
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

    @plugs.tag
    def play(self):
        self._mpd.play()

    @plugs.tag
    def stop(self):
        self._mpd.stop()

    @plugs.tag
    def next(self):
        self._mpd.next()

    @plugs.tag
    def prev(self):
        self._mpd.prev()

    @plugs.tag
    def toggle(self):
        self._mpd.toggle()

    @plugs.tag
    def pause(self, state: int = 1):
        self._mpd.pause(state)

    @plugs.tag
    def seek(self, new_time: float):
        self._mpd.seek(new_time)

    @plugs.tag
    def rewind(self):
        self._mpd.rewind()

    # ------------------------------------------------------------------
    # Library (via Mopidy Spotify extension)
    # ------------------------------------------------------------------

    @plugs.tag
    def list_albums(self) -> list:
        """
        List Spotify albums.

        Uses Mopidy's find/lsinfo for spotify: URIs.
        Returns list of {name, uri, artist, cover_art_url, type}.
        """
        # Mopidy with spotify extension supports browsing spotify: URIs
        try:
            items = self._mpd.list_spotify_albums()
        except Exception as e:
            logger.error(f"Could not list Spotify albums: {e}")
            return []
        return items

    @plugs.tag
    def get_folder_content(self, folder: str) -> list:
        """
        List tracks in a Spotify album/playlist.

        :param folder: Spotify URI (spotify:album:xxx)
        """
        if not folder.startswith('spotify:'):
            logger.error(f"Expected Spotify URI, got: '{folder}'")
            return []

        try:
            items = self._mpd.get_folder_content_for_uri(folder)
        except Exception as e:
            logger.error(f"Could not list Spotify folder '{folder}': {e}")
            return []
        return items

    @plugs.tag
    def list_all_dirs(self) -> list:
        """
        List top-level Spotify categories.
        
        Returns: Your Library, Featured Playlists, New Releases, etc.
        """
        # Mopidy can browse spotify: root
        try:
            views = self._mpd.list_spotify_roots()
        except Exception as e:
            logger.error(f"Could not list Spotify roots: {e}")
            return []
        return views

    @plugs.tag
    def search(self, query: str) -> list:
        """
        Search Spotify for tracks, albums, artists, and playlists.

        Uses Mopidy's search with 'spotify:' backend hint.

        :param query: Search term
        :return: List of {name, uri, type, artist, album, cover_art_url}
        """
        try:
            results = self._mpd.search_spotify(query)
        except Exception as e:
            logger.error(f"Spotify search failed for '{query}': {e}")
            return []
        return results

    # ------------------------------------------------------------------
    # Cover Art
    # ------------------------------------------------------------------

    @plugs.tag
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        """
        Get cover art URL for a Spotify track.

        Spotify provides cover art URLs via the API.
        If cover_cache_dir is configured, the image is downloaded and cached.
        """
        # Mopidy returns cover art URIs in track metadata
        track_info = self._mpd.get_song_metadata(song_url)
        if track_info:
            cover_url = track_info.get('cover_art_url')
            if cover_url:
                if self._cover_cache_dir:
                    return self._cache_cover_art(cover_url)
                return cover_url
        return None

    @plugs.tag
    def get_album_coverart(self, albumartist: str, album: str) -> Optional[str]:
        """Get cover art for a Spotify album."""
        results = self.search(f"{albumartist} {album}")
        albums = [r for r in results if r.get('type') == 'album']
        if albums:
            return albums[0].get('cover_art_url')
        return None

    def _cache_cover_art(self, url: str) -> Optional[str]:
        """
        Download and cache a cover art image.

        :param url: Remote image URL
        :return: Local cache filename, or None on failure
        """
        if not self._cover_cache_dir:
            return url

        import os
        import hashlib
        cache_key = hashlib.sha256(url.encode()).hexdigest()
        cache_path = os.path.join(self._cover_cache_dir, f"{cache_key}.jpg")

        if not os.path.exists(cache_path):
            try:
                import requests
                r = requests.get(url, timeout=10)
                r.raise_for_status()
                with open(cache_path, 'wb') as f:
                    f.write(r.content)
                logger.debug(f"Cached cover art: {cache_path}")
            except Exception as e:
                logger.error(f"Could not cache cover art from {url}: {e}")
                return url  # Fall back to remote URL

        return cache_path

    # ------------------------------------------------------------------
    # Library Management
    # ------------------------------------------------------------------

    @plugs.tag
    def update(self):
        """Spotify content is managed by Mopidy. No local update needed."""
        pass

    @plugs.tag
    def update_wait(self):
        self.update()

    @plugs.tag
    def get_player_type_and_version(self) -> str:
        return f"spotify (via {self._mpd.get_player_type_and_version()})"

    # ------------------------------------------------------------------
    # Spotify-spezifische Methoden (nicht im MediaProvider ABC)
    # ------------------------------------------------------------------

    @plugs.tag
    def get_featured_playlists(self) -> list:
        """Get Spotify's featured playlists."""
        try:
            return self._mpd.list_spotify_featured()
        except Exception as e:
            logger.error(f"Could not get featured playlists: {e}")
            return []

    @plugs.tag
    def get_user_playlists(self) -> list:
        """Get the authenticated user's Spotify playlists."""
        try:
            return self._mpd.list_spotify_user_playlists()
        except Exception as e:
            logger.error(f"Could not get user playlists: {e}")
            return []

    @plugs.tag
    def get_new_releases(self) -> list:
        """Get Spotify's new releases."""
        try:
            return self._mpd.list_spotify_new_releases()
        except Exception as e:
            logger.error(f"Could not get new releases: {e}")
            return []
```

## cards.yaml — Beispiele

```yaml
# Spotify Album
rfid_card_spotify_album:
  provider: spotify
  value: "spotify:album:4aawyAB9vmqN3uQ7FjRGTy"

# Spotify Playlist
rfid_card_spotify_playlist:
  provider: spotify
  value: "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"

# Spotify Track
rfid_card_spotify_track:
  provider: spotify
  value: "spotify:track:4cOdK2wGLETKBW3PvgPWqT"
```

## RPC-Namespace

| RPC | Beschreibung |
|---|---|
| `spotify.provider.play_folder("spotify:album:xxx")` | Album/Playlist abspielen |
| `spotify.provider.play_single("spotify:track:xxx")` | Einzelnen Track abspielen |
| `spotify.provider.list_albums()` | Alben auflisten |
| `spotify.provider.search("query")` | Spotify durchsuchen |
| `spotify.provider.get_featured_playlists()` | Featured Playlists |
| `spotify.provider.get_user_playlists()` | Eigene Playlists |
| `spotify.provider.get_new_releases()` | Neue Veröffentlichungen |
| `misc.list_providers()` | Alle Provider auflisten (inkl. spotify) |

## Secrets-Handling

Client ID und Client Secret via `retrieve()` aus `jukebox.secrets` (Milestone 0a):

```bash
# shared/settings/secrets.conf
SPOTIFY_CLIENT_ID=your_client_id_here
SPOTIFY_CLIENT_SECRET=your_client_secret_here
```

### Was ist eine "Spotify Developer App"?

Damit Drittanbieter-Software (wie Mopidy) auf Spotify zugreifen darf, verlangt Spotify
eine **kostenlose Registrierung** als "Entwickler". Das klingt aufwändiger als es ist:

- **Keine Entwicklung nötig** — du musst keinen Code schreiben
- **Kostenlos** — es fallen keine Gebühren an
- **Einmalige Einrichtung** — dauert etwa 2 Minuten
- **Zweck**: Spotify stellt dir einen "API-Key" (Client ID + Client Secret) aus,
  damit Mopidy sich gegenüber Spotify als berechtigte Anwendung ausweisen kann

**Vergleich:** Das gleiche Prinzip wie bei Jellyfin (API-Key in `secrets.conf`) oder
SMB (Username/Passwort in `secrets.conf`). Spotify benötigt diese Credentials, um zu
wissen, *welche* Phoniebox auf *welches* Spotify-Konto zugreifen darf.

### Schritt-für-Schritt: Spotify API-Credentials erstellen

1. Gehe zu https://developer.spotify.com/dashboard
2. Melde dich mit deinem **Spotify Premium** Account an
3. Klicke auf **"Create App"**
4. Fülle das Formular aus:
   - **App Name**: `Phoniebox Jukebox` (oder beliebig, z.B. `Wohnzimmer Musikbox`)
   - **App Description**: `Phoniebox RFID Jukebox — plays music from Spotify via Mopidy`
   - **Redirect URI**: `http://localhost:8080/callback`
     (Pflichtfeld, wird für Mopidy technisch nicht gebraucht, muss aber ausgefüllt werden)
   - Haken bei den Nutzungsbedingungen setzen
5. Klicke auf **"Save"**
6. Auf der Übersichtsseite siehst du jetzt:
   - **Client ID** — ein öffentlicher Identifier (z.B. `a1b2c3d4...`)
   - **Client Secret** — klicke auf **"Show Client Secret"** (geheimer Schlüssel)
7. Kopiere beide Werte in `shared/settings/secrets.conf`:
   ```bash
   SPOTIFY_CLIENT_ID=a1b2c3d4e5f6...
   SPOTIFY_CLIENT_SECRET=g7h8i9j0k1l2...
   ```
8. **Fertig!** Einmalig gemacht, nie wieder anfassen.

**Warum ist das nötig?** Spotify erlaubt nicht, dass beliebige Software auf deren
Streaming-API zugreift. Die Registrierung stellt sicher, dass nur Anwendungen mit
gültigen Credentials (und damit identifizierbare, verantwortliche Entwickler) auf
die API zugreifen. Für den Endanwender ist es ein einmaliger Schritt — ähnlich wie
das Erstellen eines API-Keys für Jellyfin.

> **Hinweis:** Falls du bereits eine Spotify Developer App für ein anderes Projekt
> hast, kannst du dieselbe App wiederverwenden. Die Credentials sind nicht an eine
> bestimmte Software gebunden.

## Installer Contract Compliance

Das Spotify-Plugin folgt dem [Plugin-Contract von Milestone 7](07-installer-integration.md).

| Contract-Anforderung | Erfüllung durch Spotify |
|---|---|
| Repository-Struktur | `src/jukebox/components/spotify/` |
| `__init__.py` mit Plugin-Lifecycle | ✅ (initialize, finalize, atexit) |
| `requirements.txt` | Nicht benötigt (requests bereits Core-Dependency) |
| `install_dependencies.sh` | Prüft Mopidy + mopidy-spotify Installation |
| `configure.sh` | Interaktive Spotify-Client-ID/Secret Konfiguration |
| Registry-Eintrag | Siehe Milestone 7 |

## Aktivierung durch den Builder

1. **Mopidy installiert haben** (Milestone 8) oder `sudo apt-get install mopidy mopidy-spotify`

2. **Spotify Developer App erstellen** → Client ID + Secret in `secrets.conf`:
   ```bash
   SPOTIFY_CLIENT_ID=xxx
   SPOTIFY_CLIENT_SECRET=xxx
   ```

3. **Plugin in `modules.others` aktivieren:**
   ```yaml
   modules:
     others:
       - spotify   # ← Aktivieren
   ```

4. **Karten zuweisen:**
   ```yaml
   rfid_card_01:
     provider: spotify
     value: "spotify:album:4aawyAB9vmqN3uQ7FjRGTy"
   ```

5. **Jukebox neustarten**

## Tests

### Neu: `test/spotify/test_spotify_provider.py`

- Test: `SpotifyMediaProvider`-Initialisierung mit gemocktem Mopidy-Backend
- Test: `play_folder("spotify:album:xxx")` delegiert korrekt an MPD/mopidy
- Test: `play_single("spotify:track:xxx")` spielt einzelnen Track
- Test: `list_albums()` gibt Spotify-Alben zurück
- Test: `search("query")` gibt Suchergebnisse zurück
- Test: `get_folder_content("spotify:album:xxx")` listet Tracks
- Test: `initialize()` mit fehlender Client-ID → loggt Fehler
- Test: `play_folder()` mit ungültigem URI → loggt Fehler
- Test: `shutdown()` cleanup
- Test: `play_card()` wird NICHT überschrieben (Basisklasse)
- Test: Alle Methoden haben `plugs_callable`-Attribut (`@plugs.tag` wirksam)
- Test: Second-Swipe mit gleichem Spotify-URI

## Akzeptanzkriterien

- [ ] `SpotifyMediaProvider` implementiert alle `MediaProvider`-Methoden
- [ ] Alle RPC-callable Methoden sind mit `@plugs.tag` dekoriert
- [ ] `SpotifyMediaProvider.play_card()` ist NICHT überschrieben (Basisklasse)
- [ ] Second-Swipe-Verhalten gleich wie bei MPD/Jellyfin/SMB
- [ ] `play_card_callbacks` werden gefeuert (zentral über Manager)
- [ ] Plugin registriert sich nur, wenn Mopidy-Backend verfügbar
- [ ] Plugin validiert Spotify-Client-ID/Secret und gibt aussagekräftige Fehler
- [ ] `spotify.provider.play_folder("spotify:album:xxx")` funktioniert via RPC
- [ ] `spotify.provider.search("query")` funktioniert via RPC
- [ ] Cover-Art-URLs werden korrekt zurückgegeben
- [ ] `cards.yaml` mit `provider: spotify` funktioniert end-to-end
- [ ] `@atexit` shutdown funktioniert fehlerfrei
- [ ] Fehlkonfiguration wird geloggt, nicht gecrasht

## Bekannte Einschränkungen

1. **Spotify Premium erforderlich** — Spotify's Web API und Mopidy's Spotify-Extension
   benötigen ein Spotify Premium Abonnement. Free Accounts werden nicht unterstützt.

2. **Mopidy-Abhängigkeit** — Ohne Mopidy + mopidy-spotify funktioniert dieser Provider
   nicht. MPD allein kann keine Spotify-Streams abspielen.

3. **API-Rate-Limits** — Spotify's Web API hat Rate Limits. Bei intensiver Nutzung
   (häufiges Browsen, Suchen) können Anfragen gedrosselt werden.

4. **Token-Refresh** — Mopidy's Spotify-Extension managed OAuth-Token-Refresh
   automatisch. Manuelles Eingreifen ist nur bei initialer Einrichtung nötig.

5. **Offline-Modus** — Spotify erfordert eine Internetverbindung. Ohne Netzwerk
   sind Spotify-Inhalte nicht verfügbar. Lokale MPD-Dateien funktionieren weiterhin.

---

*Milestone 9 — Optional — Erfordert M8 (Mopidy Migration)*