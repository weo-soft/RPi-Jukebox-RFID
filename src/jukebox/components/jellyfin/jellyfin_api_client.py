"""HTTP client for the Jellyfin REST API.

The client is a pure HTTP wrapper: authenticated catalog queries, stream URL
generation and cover-art downloads. It holds no player state and never logs
the API key.
"""

import logging
from typing import Optional

import requests


logger = logging.getLogger('jb.player.jellyfin')

#: Default request timeout in seconds for all Jellyfin API calls.
DEFAULT_TIMEOUT = 30.0


class JellyfinApiClient:
    """Small authenticated client for the Jellyfin REST API (10.8+).

    :param host: Base URL of the Jellyfin server (e.g. ``http://jellyfin.local:8096``).
    :param api_key: Jellyfin API key (``X-Emby-Token``).
    """

    _DEFAULT_HEADERS = {
        'X-Emby-Client': 'Phoniebox',
        'X-Emby-Device-Id': 'phoniebox',
        'X-Emby-Device-Name': 'Phoniebox',
        'Content-Type': 'application/json',
    }

    def __init__(
            self,
            host: str,
            api_key: str,
            *,
            session: Optional[requests.Session] = None,
            timeout: float = DEFAULT_TIMEOUT):
        host = (host or '').strip()
        # A scheme-less host (e.g. "192.168.178.26:8096") is treated as plain
        # HTTP so that requests can build a valid URL.
        if host and '://' not in host:
            host = f'http://{host}'
        self.host = host.rstrip('/')
        self.api_key = api_key or ''
        self.timeout = timeout
        self._session = session if session is not None else requests.Session()
        self._session.headers.update(self._DEFAULT_HEADERS)
        self._session.headers['X-Emby-Token'] = self.api_key

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def authenticate(self) -> bool:
        """Validate the API key against the Jellyfin server.

        Returns ``True`` when the key is accepted and ``False`` when the
        server rejects it (HTTP 401/403). Network/transport failures are
        raised as ``requests.RequestException`` so callers can distinguish
        an invalid key from an unreachable server.
        """
        response = self._session.get(f'{self.host}/Users/Me', timeout=self.timeout)
        if response.status_code in (401, 403):
            logger.error('Jellyfin rejected the API key (HTTP %s)', response.status_code)
            return False
        response.raise_for_status()
        return True
    # ------------------------------------------------------------------
    # Catalog
    # ------------------------------------------------------------------

    @staticmethod
    def _catalog_params(**extra):
        """Query parameters for every catalog list request.

        Per-item user data and all image types except the primary tag are
        dropped so catalog payloads stay small on resource-constrained
        hardware.
        """
        params = {
            'EnableUserData': 'false',
            'EnableImageTypes': 'Primary',
            'ImageTypeLimit': '1',
        }
        params.update(extra)
        return params

    def _get_json(self, path: str, params=None) -> dict:
        url = f'{self.host}{path}'
        response = self._session.get(url, params=params, timeout=self.timeout)
        response.raise_for_status()
        return response.json()

    def get_items_in_folder(self, parent_id: str) -> list:
        """Return the direct children of a Jellyfin folder/item."""
        params = self._catalog_params(parentId=parent_id, Recursive='false')
        data = self._get_json('/Items', params=params)
        return data.get('Items') or []

    def get_albums(self, limit: Optional[int] = None, start_index: Optional[int] = None) -> list:
        """Return all music albums on the server (recursive query)."""
        params = self._catalog_params(
            includeItemTypes='MusicAlbum',
            Recursive='true',
        )
        if limit is not None:
            params['Limit'] = limit
        if start_index is not None:
            params['StartIndex'] = start_index
        data = self._get_json('/Items', params=params)
        return data.get('Items') or []

    def get_album_children(self, album_id: str) -> list:
        """Return the audio items directly inside an album."""
        params = self._catalog_params(
            parentId=album_id,
            Recursive='false',
            includeItemTypes='Audio',
        )
        data = self._get_json('/Items', params=params)
        return data.get('Items') or []

    def get_item(self, item_id: str) -> dict:
        """Return the metadata for a single item."""
        return self._get_json(f'/Items/{item_id}')

    def search(self, query: str, limit: Optional[int] = None, start_index: Optional[int] = None) -> list:
        """Search the library and return the hint results."""
        params = {'searchTerm': query}
        if limit is not None:
            params['Limit'] = limit
        if start_index is not None:
            params['StartIndex'] = start_index
        data = self._get_json('/Search/Hints', params=params)
        return data.get('SearchHints') or []

    # ------------------------------------------------------------------
    # Playback and cover art
    # ------------------------------------------------------------------

    def get_stream_url(self, item_id: str) -> str:
        """Build the static HTTP stream URL for an audio item.

        ``static=true`` requests a direct, untranscoded stream that MPD can
        play. The URL carries the API key and is therefore only pushed into
        the MPD playlist; it must never surface on an RPC/publish channel.
        """
        return f'{self.host}/Audio/{item_id}/stream?static=true&api_key={self.api_key}'

    def get_coverart_bytes(self, item_id: str, max_size: int = 300) -> bytes:
        """Download the primary cover image of an item through the session."""
        url = (
            f'{self.host}/Items/{item_id}/Images/Primary'
            f'?maxHeight={max_size}&maxWidth={max_size}'
        )
        response = self._session.get(url, timeout=self.timeout)
        response.raise_for_status()
        return response.content

    def close(self) -> None:
        """Close the underlying HTTP session."""
        self._session.close()
