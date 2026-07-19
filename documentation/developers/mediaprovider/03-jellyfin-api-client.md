# Milestone 3 — Plugin: Jellyfin API Client

## Ziel

REST-API-Client für Jellyfin entwickeln, der Authentifizierung, Library-Abfragen und Stream-URL-Generierung übernimmt. Dies ist die Basis für den Jellyfin MediaProvider (Milestone 4).

## Abhängigkeiten

- Milestone 0 (Prerequisites — `jukebox.secrets.retrieve()`)
- Milestone 1 (MediaProvider Interface) ist abgeschlossen (für Typhinweise)
- **Keine Abhängigkeit** von Milestone 2 — der Client ist standalone entwickelbar

## Scope

- Neues Package `src/jukebox/components/jellyfin/`
- API-Client in `jellyfin_api_client.py`
- Unterstützt Jellyfin 10.8.x+ REST-API
- Authentifizierung per API-Key
- Keine Abhängigkeit zum Jukebox-Core (nur `requests`)

## Konfiguration

Da jedes Plugin seinen eigenen top-level Config-Key bekommt (konsistent mit `playermpd:`, `pulse:`, etc.):

```yaml
jellyfin:
  host: http://jellyfin.local:8096
  # api_key wird bevorzugt aus der Umgebungsvariable JELLYFIN_API_KEY gelesen
  # (siehe documentation/develope00a-secrets-infrastructure.md)
  # Fallback: api_key direkt in jukebox.yaml (nicht empfohlen)
  api_key: ""
  cache_dir: ~/RPi-Jukebox-RFID/shared/artifacts/jellyfin_cache
```

## Secrets-Resolution

Der Jellyfin API-Key ist ein sensibler Wert, der nicht im Klartext in `jukebox.yaml` stehen sollte.
Stattdessen wird die `retrieve()`-Funktion aus `jukebox.secrets` verwendet, die folgende Priorität hat:

1. **Umgebungsvariable `JELLYFIN_API_KEY`** — aus `secrets.conf` via `run_jukebox.sh` geladen (empfohlen)
2. **YAML-Konfiguration `jellyfin.api_key`** — Fallback für Abwärtskompatibilität

Siehe [Secrets Handling](00a-secrets-infrastructure.md) für Details zur Einrichtung.

## Neu: `src/jukebox/components/jellyfin/jellyfin_api_client.py`

```python
"""
Jellyfin REST API Client

Dieser Client kommuniziert mit einem Jellyfin-Server über die REST-API.
Er wird vom JellyfinMediaProvider (Milestone 4) verwendet.

Jellyfin API Referenz: https://api.jellyfin.org/

Authentication:
    Per API-Key (Header: X-Emby-Token).
    Der API-Key wird via jukebox.secrets.retrieve() aufgelöst:
    - Bevorzugt aus Umgebungsvariable JELLYFIN_API_KEY
    - Fallback aus jukebox.yaml (jellyfin.api_key)
    
    Siehe documentation/develope00a-secrets-infrastructure.md
"""

import requests
import logging
from typing import Optional

logger = logging.getLogger('jb.jellyfin.api')


class JellyfinApiClient:
    """
    Client for the Jellyfin REST API.

    Provides methods for:
    - Authentication (API key validation)
    - Library queries (views, items, albums)
    - Stream URL generation
    - Cover art URL generation
    """

    def __init__(self, host: str, api_key: str):
        """
        :param host: Jellyfin server URL (e.g., http://jellyfin.local:8096)
        :param api_key: Jellyfin API key (created in Dashboard → API Keys)
        """
        self.host = host.rstrip('/')
        self.api_key = api_key
        self._session = requests.Session()
        self._session.headers.update({
            'X-Emby-Token': api_key,
            'Content-Type': 'application/json',
        })
        self._user_id: Optional[str] = None

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def authenticate(self) -> bool:
        """
        Validate API key against the Jellyfin server.

        Makes a GET request to /System/Info. If the server responds
        with HTTP 200, the API key is valid.

        :return: True if authentication succeeded, False otherwise
        """
        try:
            r = self._session.get(f"{self.host}/System/Info")
            r.raise_for_status()
            logger.info(f"Connected to Jellyfin server: {self.host}")
            return True
        except requests.RequestException as e:
            logger.error(f"Jellyfin authentication failed: {e}")
            return False

    # ------------------------------------------------------------------
    # Library / Items
    # ------------------------------------------------------------------

    def get_views(self) -> list[dict]:
        """
        Get top-level library views (e.g., "Music", "Movies").

        Requires user resolution first (cached in self._user_id).

        :return: List of view items with 'Id', 'Name', 'Type' keys
        """
        if not self._user_id:
            self._resolve_user()
        r = self._session.get(f"{self.host}/Users/{self._user_id}/Views")
        r.raise_for_status()
        data = r.json()
        return data.get('Items', [])

    def get_items_in_folder(self, parent_id: str) -> list[dict]:
        """
        Get child items of a folder/item (non-recursive).

        :param parent_id: Jellyfin item ID of the parent folder
        :return: List of items (Audio, Album, Artist, etc.)
        """
        r = self._session.get(f"{self.host}/Items", params={
            'parentId': parent_id,
            'Recursive': False,
        })
        r.raise_for_status()
        data = r.json()
        return data.get('Items', [])

    def get_albums(self) -> list[dict]:
        """
        Get all music albums from the library.

        :return: List of album items with 'Id', 'Name', 'AlbumArtist', etc.
        """
        r = self._session.get(f"{self.host}/Items", params={
            'includeItemTypes': 'MusicAlbum',
            'Recursive': True,
        })
        r.raise_for_status()
        data = r.json()
        return data.get('Items', [])

    def get_artists(self) -> list[dict]:
        """
        Get all artists from the library.

        :return: List of artists
        """
        r = self._session.get(f"{self.host}/Artists")
        r.raise_for_status()
        data = r.json()
        return data.get('Items', [])

    def search(self, query: str) -> list[dict]:
        """
        Search the Jellyfin library.

        :param query: Search term
        :return: List of search results
        """
        r = self._session.get(f"{self.host}/Search/Hints", params={
            'searchTerm': query,
        })
        r.raise_for_status()
        data = r.json()
        return data.get('SearchHints', [])

    # ------------------------------------------------------------------
    # Playback
    # ------------------------------------------------------------------

    def get_stream_url(self, item_id: str) -> str:
        """
        Get a direct HTTP stream URL for an audio item.

        MPD can play this URL directly.

        :param item_id: Jellyfin item ID (Audio type)
        :return: Full stream URL (e.g., http://jellyfin:8096/Audio/.../stream)
        """
        return f"{self.host}/Audio/{item_id}/stream?static=true"

    # ------------------------------------------------------------------
    # Cover Art
    # ------------------------------------------------------------------

    def get_coverart_url(self, item_id: str, max_size: int = 300) -> str:
        """
        Get the cover art image URL for an item.

        :param item_id: Jellyfin item ID
        :param max_size: Maximum image dimension in pixels
        :return: Full cover art URL
        """
        return (f"{self.host}/Items/{item_id}/Images/Primary"
                f"?maxHeight={max_size}&maxWidth={max_size}")

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _resolve_user(self):
        """
        Resolve the user ID associated with the API key.

        Makes a GET request to /Users/Me and caches the user ID.
        This is needed for user-specific endpoints like /Users/{id}/Views.
        """
        r = self._session.get(f"{self.host}/Users/Me")
        r.raise_for_status()
        self._user_id = r.json().get('Id')
        logger.debug(f"Resolved Jellyfin user ID: {self._user_id}")
```

## Tests

### Neu: `test/jellyfin/test_jellyfin_api_client.py`

- Mock `requests.Session` oder `responses`-Bibliothek verwenden
- Test: `authenticate()` mit gültigem/ungültigem API-Key
- Test: `get_views()` nach erfolgreicher Authentifizierung
- Test: `get_items_in_folder()` mit gemockter Response
- Test: `get_stream_url()` generiert korrekte URL
- Test: `get_coverart_url()` generiert korrekte URL

## Verzeichnisstruktur

```
src/jukebox/components/jellyfin/
├── __init__.py                    # (vorerst leer, wird in Milestone 4 gefüllt)
├── jellyfin_api_client.py         # ← dieser Milestone
└── requirements.txt               # requests>=2.28.0
```

## Notizen zur Jellyfin-API

- API-Key wird als Header `X-Emby-Token` gesendet
- Alle Endpunkte liefern JSON zurück mit einem `Items`- oder `SearchHints`-Array
- Für user-spezifische Endpunkte wird die User-ID benötigt (über `/Users/Me` auflösbar)
- Stream-URLs sind direkte HTTP-Streams, die MPD abspielen kann

## Abhängigkeiten & Installationskontext

Die einzige externe Python-Abhängigkeit ist `requests`. Diese ist bereits eine Core-Abhängigkeit des Projekts (`requirements.txt`, Zeile 18: `requests`). Der Core-Installer (`installation/install-jukebox.sh` → `setup_jukebox_core()` → `_jukebox_core_install_python_requirements()`) installiert `requests` automatisch via `pip install -r requirements.txt`.

Für lokale Entwicklung/Testing außerhalb der Phoniebox-Installation wird empfohlen, `requests` manuell zu installieren:
```bash
pip install requests>=2.28.0
```

## Akzeptanzkriterien

- [ ] `JellyfinApiClient` kann instanziiert werden
- [ ] `authenticate()` validiert den API-Key gegen den Server
- [ ] `get_views()` gibt Library-Views zurück
- [ ] `get_items_in_folder()` gibt Kind-Items zurück
- [ ] `get_albums()` gibt alle Alben zurück
- [ ] `get_stream_url()` generiert eine gültige Stream-URL
- [ ] `get_coverart_url()` generiert eine gültige Cover-Art-URL
- [ ] Alle Tests laufen durch (mit gemocktem Server)