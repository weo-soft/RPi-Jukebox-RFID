"""Tests for JellyfinApiClient."""
import pytest
from unittest import mock
import requests
from components.jellyfin.jellyfin_api_client import (
    JellyfinApiClient,
    AuthenticationError,
)


def _build_mock_response(json_data, status_code=200):
    """Create a mock requests.Response with JSON data."""
    resp = mock.Mock(spec=requests.Response)
    resp.json.return_value = json_data
    resp.status_code = status_code
    resp.raise_for_status = mock.Mock()
    if status_code >= 400:
        resp.raise_for_status.side_effect = requests.HTTPError(
            f"HTTP {status_code}", response=resp
        )
    return resp


class TestJellyfinApiClientInit:
    """Tests for client construction."""

    def test_creates_session_with_api_key(self):
        client = JellyfinApiClient("http://jellyfin:8096", api_key="key123")
        assert client.host == "http://jellyfin:8096"
        assert client.api_key == "key123"
        assert "X-Emby-Token" in client._session.headers

    def test_creates_session_with_credentials(self):
        client = JellyfinApiClient(
            "http://jellyfin:8096",
            username="user1", password="pass1",
        )
        assert client._username == "user1"
        assert client._password == "pass1"
        assert "X-Emby-Token" not in client._session.headers

    def test_creates_session_with_both(self):
        client = JellyfinApiClient(
            "http://jellyfin:8096",
            api_key="key123",
            username="user1", password="pass1",
        )
        assert client.api_key == "key123"
        assert "X-Emby-Token" in client._session.headers

    def test_strips_trailing_slash_from_host(self):
        client = JellyfinApiClient("http://jellyfin:8096/", api_key="key123")
        assert client.host == "http://jellyfin:8096"


class TestAuthenticate:
    """Tests for authenticate()."""

    def test_success_with_api_key(self):
        client = JellyfinApiClient("http://jellyfin:8096", api_key="key123")
        with mock.patch.object(
            client._session, 'get',
            return_value=_build_mock_response(
                {"ServerName": "MyJellyfin"},
            ),
        ) as mock_get:
            result = client.authenticate()
            assert result is True
            mock_get.assert_called_once_with(
                "http://jellyfin:8096/System/Info"
            )

    def test_connection_error_raises(self):
        client = JellyfinApiClient("http://jellyfin:8096", api_key="key123")
        with mock.patch.object(
            client._session, 'get',
            side_effect=requests.exceptions.ConnectionError("refused"),
        ):
            with pytest.raises(AuthenticationError, match="Cannot connect"):
                client.authenticate()

    def test_api_key_rejected_raises(self):
        client = JellyfinApiClient("http://jellyfin:8096", api_key="key123")
        resp = _build_mock_response({}, status_code=401)
        with mock.patch.object(
            client._session, 'get', return_value=resp,
        ):
            with pytest.raises(
                AuthenticationError, match="API key rejected",
            ):
                client.authenticate()

    def test_credential_fallback_when_no_api_key(self):
        client = JellyfinApiClient(
            "http://jellyfin:8096",
            username="user1", password="pass1",
        )
        # /System/Info returns 401 (no token set)
        get_resp = _build_mock_response({}, status_code=401)
        # /Users/AuthenticateByName succeeds
        auth_resp = _build_mock_response(
            {"AccessToken": "token-abc", "User": {"Id": "u1"}},
        )
        # Second /System/Info succeeds after token is set
        info_resp = _build_mock_response({"ServerName": "Jelly"})

        with mock.patch.object(
            client._session, 'get',
            side_effect=[get_resp, info_resp],
        ), mock.patch.object(
            client._session, 'post',
            return_value=auth_resp,
        ) as mock_post:
            result = client.authenticate()
            assert result is True
            # Should have called POST to AuthenticateByName
            mock_post.assert_called_once_with(
                "http://jellyfin:8096/Users/AuthenticateByName",
                json={'Username': 'user1', 'Pw': 'pass1'},
            )
            # Token should be set
            assert client._session.headers['X-Emby-Token'] == 'token-abc'

    def test_both_methods_fail_raises(self):
        client = JellyfinApiClient(
            "http://jellyfin:8096",
            username="user1", password="pass1",
        )
        get_resp = _build_mock_response({}, status_code=401)
        auth_resp = _build_mock_response({}, status_code=401)

        with mock.patch.object(
            client._session, 'get', return_value=get_resp,
        ), mock.patch.object(
            client._session, 'post', return_value=auth_resp,
        ):
            with pytest.raises(
                AuthenticationError, match="both",
            ):
                client.authenticate()


class TestAuthByCredentials:
    """Tests for _authenticate_by_credentials()."""

    def test_returns_token(self):
        client = JellyfinApiClient(
            "http://jellyfin:8096",
            username="user1", password="pass1",
        )
        resp = _build_mock_response({"AccessToken": "token-123"})
        with mock.patch.object(
            client._session, 'post', return_value=resp,
        ) as mock_post:
            token = client._authenticate_by_credentials()
            assert token == "token-123"
            mock_post.assert_called_once_with(
                "http://jellyfin:8096/Users/AuthenticateByName",
                json={'Username': 'user1', 'Pw': 'pass1'},
            )
            assert client._session.headers['X-Emby-Token'] == "token-123"

    def test_no_token_in_response_raises(self):
        client = JellyfinApiClient(
            "http://jellyfin:8096",
            username="user1", password="pass1",
        )
        resp = _build_mock_response({})  # no AccessToken
        with mock.patch.object(
            client._session, 'post', return_value=resp,
        ):
            with pytest.raises(
                AuthenticationError, match="no AccessToken",
            ):
                client._authenticate_by_credentials()

    def test_http_error_raises(self):
        client = JellyfinApiClient(
            "http://jellyfin:8096",
            username="user1", password="pass1",
        )
        resp = _build_mock_response({}, status_code=401)
        with mock.patch.object(
            client._session, 'post', return_value=resp,
        ):
            with pytest.raises(
                AuthenticationError, match="credential auth failed",
            ):
                client._authenticate_by_credentials()

    def test_connection_error_raises(self):
        client = JellyfinApiClient(
            "http://jellyfin:8096",
            username="user1", password="pass1",
        )
        with mock.patch.object(
            client._session, 'post',
            side_effect=requests.exceptions.ConnectionError("refused"),
        ):
            with pytest.raises(
                AuthenticationError, match="Cannot connect",
            ):
                client._authenticate_by_credentials()


class TestResolveUser:
    """Tests for _resolve_user()."""

    def test_resolves_and_caches(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        resp = _build_mock_response({"Id": "user-abc"})
        with mock.patch.object(
            client._session, 'get', return_value=resp,
        ) as mock_get:
            uid1 = client._resolve_user()
            uid2 = client._resolve_user()
            assert uid1 == "user-abc"
            assert uid2 == "user-abc"
            # Second call uses cache, no extra HTTP
            assert mock_get.call_count == 1

    def test_missing_id_raises(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        resp = _build_mock_response({})
        with mock.patch.object(
            client._session, 'get', return_value=resp,
        ):
            with pytest.raises(AuthenticationError, match="resolve"):
                client._resolve_user()


class TestGetViews:
    """Tests for get_views()."""

    def test_returns_items(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        # Mock _resolve_user so we don't hit /Users/Me
        client._user_id = "user-abc"
        resp = _build_mock_response({
            "Items": [
                {"Id": "v1", "Name": "Music", "Type": "CollectionFolder"},
            ],
        })
        with mock.patch.object(
            client._session, 'get', return_value=resp,
        ) as mock_get:
            views = client.get_views()
            assert len(views) == 1
            assert views[0]["Name"] == "Music"
            mock_get.assert_called_once_with(
                "http://jellyfin:8096/Users/user-abc/Views"
            )


class TestGetItemsInFolder:
    """Tests for get_items_in_folder()."""

    def test_returns_child_items(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        resp = _build_mock_response({
            "Items": [
                {"Id": "t1", "Name": "Song 1", "Type": "Audio"},
                {"Id": "t2", "Name": "Song 2", "Type": "Audio"},
            ],
        })
        with mock.patch.object(
            client._session, 'get', return_value=resp,
        ) as mock_get:
            items = client.get_items_in_folder("parent-id")
            assert len(items) == 2
            assert items[0]["Name"] == "Song 1"
            mock_get.assert_called_once_with(
                "http://jellyfin:8096/Items",
                params={'parentId': 'parent-id', 'Recursive': False},
            )

    def test_recursive_flag(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        resp = _build_mock_response({"Items": []})
        with mock.patch.object(
            client._session, 'get', return_value=resp,
        ) as mock_get:
            client.get_items_in_folder("parent-id", recursive=True)
            mock_get.assert_called_once_with(
                "http://jellyfin:8096/Items",
                params={'parentId': 'parent-id', 'Recursive': True},
            )


class TestGetAlbums:
    """Tests for get_albums()."""

    def test_filters_music_albums(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        resp = _build_mock_response({
            "Items": [
                {"Id": "a1", "Name": "Album 1"},
            ],
        })
        with mock.patch.object(
            client._session, 'get', return_value=resp,
        ) as mock_get:
            albums = client.get_albums()
            assert len(albums) == 1
            mock_get.assert_called_once_with(
                "http://jellyfin:8096/Items",
                params={
                    'includeItemTypes': 'MusicAlbum',
                    'Recursive': True,
                },
            )


class TestGetItem:
    """Tests for get_item()."""

    def test_returns_single_item(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        resp = _build_mock_response({
            "Id": "item-1",
            "Name": "My Track",
            "Type": "Audio",
        })
        with mock.patch.object(
            client._session, 'get', return_value=resp,
        ) as mock_get:
            item = client.get_item("item-1")
            assert item["Id"] == "item-1"
            mock_get.assert_called_once_with(
                "http://jellyfin:8096/Items/item-1"
            )


class TestSearch:
    """Tests for search()."""

    def test_returns_search_hints(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        resp = _build_mock_response({
            "SearchHints": [
                {"Id": "s1", "Name": "Search Result 1", "Type": "Audio"},
            ],
        })
        with mock.patch.object(
            client._session, 'get', return_value=resp,
        ) as mock_get:
            results = client.search("test")
            assert len(results) == 1
            mock_get.assert_called_once_with(
                "http://jellyfin:8096/Search/Hints",
                params={"searchTerm": "test"},
            )


class TestStreamUrl:
    """Tests for get_stream_url()."""

    def test_generates_correct_url(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        url = client.get_stream_url("audio-id-42")
        assert "Audio/audio-id-42/stream" in url
        assert "static=true" in url


class TestCoverArt:
    """Tests for get_coverart_url()."""

    def test_generates_url_with_default_size(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        url = client.get_coverart_url("item-id")
        assert "Items/item-id/Images/Primary" in url
        assert "maxHeight=300" in url
        assert "maxWidth=300" in url

    def test_respects_custom_size(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        url = client.get_coverart_url("item-id", max_size=600)
        assert "maxHeight=600" in url
        assert "maxWidth=600" in url


class TestClose:
    """Tests for close()."""

    def test_closes_session(self):
        client = JellyfinApiClient("http://jellyfin:8096", "key123")
        with mock.patch.object(client._session, 'close') as mock_close:
            client.close()
            mock_close.assert_called_once()
