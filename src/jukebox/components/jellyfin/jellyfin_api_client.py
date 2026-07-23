"""
Jellyfin REST API Client

Communicates with a Jellyfin server via its REST API. Used by
JellyfinMediaProvider for metadata, library queries, and stream URL
generation.

Reference: https://api.jellyfin.org/

Authentication: tries API key first, falls back to username+password.
"""

import logging
from typing import Optional

import requests

logger = logging.getLogger('jb.jellyfin.api')


class JellyfinApiClientError(Exception):
    """Base exception for Jellyfin API client errors."""


class AuthenticationError(JellyfinApiClientError):
    """Raised when authentication fails (token or credentials)."""


class JellyfinApiClient:
    """
    Client for the Jellyfin REST API.

    Provides methods for:
    - Authentication (API key, or username + password)
    - Library queries (views, items, albums)
    - Stream URL generation
    - Cover art URL generation

    Authentication priority:
    1. API key via X-Emby-Token header (preferred)
    2. Username + password via /Users/AuthenticateByName (fallback)
    """

    def __init__(self, host: str, api_key: str = '',
                 username: str = '', password: str = ''):
        """
        :param host: Jellyfin server URL (e.g. http://jellyfin.local:8096)
        :param api_key: Jellyfin API key (Dashboard → API Keys)
        :param username: Jellyfin username (fallback if no api_key)
        :param password: Jellyfin password (fallback if no api_key)
        """
        self.host = host.rstrip('/')
        self.api_key = api_key
        self._username = username
        self._password = password
        self._session = requests.Session()
        self._session.headers.update({
            'Content-Type': 'application/json',
        })
        if api_key:
            self._session.headers['X-Emby-Token'] = api_key
        self._user_id: Optional[str] = None
        self._token_from_credentials: Optional[str] = None

    # ------------------------------------------------------------------
    # Authentication
    # ------------------------------------------------------------------

    def _authenticate_by_credentials(self) -> str:
        """
        Authenticate using username + password.

        POSTs to /Users/AuthenticateByName and returns the access
        token. The token is stored and used as X-Emby-Token for
        subsequent requests.

        :return: The access token string
        :raises AuthenticationError: If credentials are invalid
               or the endpoint is unreachable
        """
        try:
            r = self._session.post(
                f"{self.host}/Users/AuthenticateByName",
                json={
                    'Username': self._username,
                    'Pw': self._password,
                },
            )
            r.raise_for_status()
        except requests.exceptions.ConnectionError as e:
            raise AuthenticationError(
                f"Cannot connect to Jellyfin at {self.host}: {e}"
            ) from e
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code if e.response is not None else '?'
            raise AuthenticationError(
                f"Jellyfin credential auth failed (HTTP {status})"
            ) from e

        data = r.json()
        token = data.get('AccessToken')
        if not token:
            raise AuthenticationError(
                "Jellyfin credential auth succeeded but no "
                "AccessToken in response"
            )
        self._token_from_credentials = token
        self._session.headers['X-Emby-Token'] = token
        logger.info(
            f"Authenticated to Jellyfin as user '{self._username}'"
        )
        return token

    def _resolve_user(self) -> str:
        """
        Resolve the user ID of the authenticated session.

        Makes a GET request to /Users/Me and caches the user ID.
        This is needed for user-specific endpoints like
        /Users/{id}/Views.

        If we authenticated via credentials, the user ID from
        /Users/AuthenticateByName response may already be cached.
        """
        if self._user_id:
            return self._user_id
        r = self._session.get(f"{self.host}/Users/Me")
        r.raise_for_status()
        self._user_id = r.json().get('Id')
        if not self._user_id:
            raise AuthenticationError(
                "Could not resolve Jellyfin user ID"
            )
        logger.debug(f"Resolved Jellyfin user ID: {self._user_id}")
        return self._user_id

    def authenticate(self) -> bool:
        """
        Validate connection to the Jellyfin server.

        Tries API key first. If no API key is set, falls back to
        username + password authentication via
        /Users/AuthenticateByName.

        :return: True if authentication succeeded
        :raises AuthenticationError: If authentication fails
        """
        try:
            r = self._session.get(f"{self.host}/System/Info")
            r.raise_for_status()
        except requests.exceptions.ConnectionError as e:
            raise AuthenticationError(
                f"Cannot connect to Jellyfin at {self.host}: {e}"
            ) from e
        except requests.exceptions.HTTPError as e:
            # If we have an API key and it failed, it's invalid
            if self.api_key:
                status = (
                    e.response.status_code
                    if e.response is not None else '?'
                )
                raise AuthenticationError(
                    f"Jellyfin API key rejected (HTTP {status})"
                ) from e
            # No API key — try username + password
            try:
                self._authenticate_by_credentials()
                # Re-validate with the new token
                r = self._session.get(f"{self.host}/System/Info")
                r.raise_for_status()
            except Exception as cred_e:
                raise AuthenticationError(
                    f"Jellyfin authentication failed with both "
                    f"API key and credentials: {cred_e}"
                ) from cred_e

        logger.info(f"Connected to Jellyfin server: {self.host}")
        return True

    # ------------------------------------------------------------------
    # Library / Items
    # ------------------------------------------------------------------

    def get_views(self) -> list[dict]:
        """
        Get top-level library views (e.g. "Music", "Movies").

        Requires user resolution first (cached in self._user_id).

        :return: List of view items with Id, Name, Type keys
        """
        uid = self._resolve_user()
        r = self._session.get(f"{self.host}/Users/{uid}/Views")
        r.raise_for_status()
        data = r.json()
        return data.get('Items', [])

    def get_items_in_folder(self, parent_id: str,
                            recursive: bool = False) -> list[dict]:
        """
        Get child items of a folder / item.

        :param parent_id: Jellyfin item ID of the parent folder
        :param recursive: If True, get all descendants
        :return: List of items (Audio, Album, Artist, etc.)
        """
        r = self._session.get(
            f"{self.host}/Items",
            params={
                'parentId': parent_id,
                'Recursive': recursive,
            },
        )
        r.raise_for_status()
        data = r.json()
        return data.get('Items', [])

    def get_items(self, **params) -> list[dict]:
        """
        Generic query against /Items with arbitrary filter params.

        :param params: Query parameters (includeItemTypes, Recursive,
                       SortBy, etc.)
        :return: List of items matching the query
        """
        r = self._session.get(f"{self.host}/Items", params=params)
        r.raise_for_status()
        data = r.json()
        return data.get('Items', [])

    def get_albums(self) -> list[dict]:
        """
        Get all music albums from the library.

        :return: List of album items with Id, Name, AlbumArtist, etc.
        """
        return self.get_items(
            includeItemTypes='MusicAlbum',
            Recursive=True,
        )

    def get_artists(self) -> list[dict]:
        """
        Get all artists from the library.

        :return: List of artist items
        """
        r = self._session.get(f"{self.host}/Artists")
        r.raise_for_status()
        data = r.json()
        return data.get('Items', [])

    def get_item(self, item_id: str) -> dict:
        """
        Get a single item by its ID.

        :param item_id: Jellyfin item ID
        :return: Full item metadata
        """
        r = self._session.get(f"{self.host}/Items/{item_id}")
        r.raise_for_status()
        return r.json()

    def search(self, query: str) -> list[dict]:
        """
        Search the Jellyfin library.

        :param query: Search term
        :return: List of search hints with Id, Name, Type, etc.
        """
        r = self._session.get(
            f"{self.host}/Search/Hints",
            params={'searchTerm': query},
        )
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
        :return: Full stream URL (e.g.
                 http://jellyfin:8096/Audio/.../stream)
        """
        return f"{self.host}/Audio/{item_id}/stream?static=true"

    # ------------------------------------------------------------------
    # Cover Art
    # ------------------------------------------------------------------

    def get_coverart_url(self, item_id: str,
                         max_size: int = 300) -> str:
        """
        Get the cover art image URL for an item.

        :param item_id: Jellyfin item ID
        :param max_size: Maximum image dimension in pixels
        :return: Full cover art URL
        """
        return (
            f"{self.host}/Items/{item_id}/Images/Primary"
            f"?maxHeight={max_size}&maxWidth={max_size}"
        )

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def close(self):
        """Close the underlying HTTP session."""
        self._session.close()
        logger.debug("Jellyfin API session closed")
