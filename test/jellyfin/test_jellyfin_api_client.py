import json

import pytest
import requests

from components.jellyfin.jellyfin_api_client import JellyfinApiClient

HOST = 'http://jellyfin.local:8096'
API_KEY = 'test-api-key'


class FakeResponse:
    def __init__(self, payload=None, status=200, content=None):
        self.payload = payload
        self.status_code = status
        self.ok = 200 <= status < 300
        if content is None:
            content = b'' if payload is None else json.dumps(payload).encode()
        self.content = content
        self.text = self.content.decode()

    def json(self):
        return self.payload

    def raise_for_status(self):
        if not self.ok:
            raise requests.HTTPError(f'HTTP {self.status_code}')


class FakeSession:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []
        self.headers = {}

    def get(self, url, params=None, timeout=None):
        self.calls.append(('GET', url, params, timeout))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response

    def close(self):
        self.calls.append(('CLOSE', None, None, None))


def make_client(session):
    return JellyfinApiClient(HOST, API_KEY, session=session)


def test_authenticate_success():
    session = FakeSession([FakeResponse({})])
    client = make_client(session)

    assert client.authenticate() is True
    method, url, params, timeout = session.calls[0]
    assert method == 'GET'
    assert url == f'{HOST}/Users/Me'
    assert timeout is not None


@pytest.mark.parametrize('status', [401, 403])
def test_authenticate_rejected_key(status):
    session = FakeSession([FakeResponse({}, status=status)])
    client = make_client(session)

    assert client.authenticate() is False


def test_authenticate_connection_error_raises():
    session = FakeSession([requests.ConnectionError('boom')])
    client = make_client(session)

    with pytest.raises(requests.RequestException):
        client.authenticate()


def test_authenticate_error_does_not_leak_api_key():
    session = FakeSession([requests.ConnectionError('boom')])
    client = make_client(session)

    with pytest.raises(requests.RequestException) as error:
        client.authenticate()

    assert API_KEY not in str(error.value)


def test_get_items_in_folder():
    session = FakeSession([FakeResponse({'Items': [{'Id': 'folder-child'}]})])
    client = make_client(session)

    assert client.get_items_in_folder('folder-1') == [{'Id': 'folder-child'}]
    _, url, params, _ = session.calls[0]
    assert url == f'{HOST}/Items'
    assert params['parentId'] == 'folder-1'
    assert params['Recursive'] == 'false'


def test_get_albums():
    session = FakeSession([FakeResponse({'Items': [{'Id': 'album-1'}]})])
    client = make_client(session)

    assert client.get_albums() == [{'Id': 'album-1'}]
    _, url, params, _ = session.calls[0]
    assert url == f'{HOST}/Items'
    assert params['includeItemTypes'] == 'MusicAlbum'
    assert params['Recursive'] == 'true'


def test_catalog_payload_flags_on_albums():
    session = FakeSession([FakeResponse({'Items': []})])
    client = make_client(session)

    client.get_albums()
    _, _, params, _ = session.calls[0]

    assert params['EnableUserData'] == 'false'
    assert params['EnableImageTypes'] == 'Primary'
    assert params['ImageTypeLimit'] == '1'
    assert 'Fields' not in params


def test_get_albums_optional_pagination_params():
    session = FakeSession([FakeResponse({'Items': []})])
    client = make_client(session)

    client.get_albums(limit=50, start_index=100)
    _, _, params, _ = session.calls[0]

    assert params['Limit'] == 50
    assert params['StartIndex'] == 100


def test_get_album_children():
    session = FakeSession([FakeResponse({'Items': [{'Id': 'track-1'}]})])
    client = make_client(session)

    assert client.get_album_children('album-1') == [{'Id': 'track-1'}]
    _, url, params, _ = session.calls[0]
    assert url == f'{HOST}/Items'
    assert params['parentId'] == 'album-1'
    assert params['Recursive'] == 'false'
    assert params['includeItemTypes'] == 'Audio'


def test_catalog_payload_flags_on_album_children():
    session = FakeSession([FakeResponse({'Items': []})])
    client = make_client(session)

    client.get_album_children('album-1')
    _, _, params, _ = session.calls[0]

    assert params['EnableUserData'] == 'false'
    assert params['EnableImageTypes'] == 'Primary'
    assert params['ImageTypeLimit'] == '1'
    assert 'Fields' not in params


def test_get_item():
    session = FakeSession([FakeResponse({'Id': 'track-1', 'Type': 'Audio'})])
    client = make_client(session)

    assert client.get_item('track-1') == {'Id': 'track-1', 'Type': 'Audio'}
    _, url, params, _ = session.calls[0]
    assert url == f'{HOST}/Items/track-1'


def test_search():
    session = FakeSession([FakeResponse({'SearchHints': [{'Id': 'hit-1'}]})])
    client = make_client(session)

    assert client.search('query') == [{'Id': 'hit-1'}]
    _, url, params, _ = session.calls[0]
    assert url == f'{HOST}/Search/Hints'
    assert params['searchTerm'] == 'query'


def test_get_stream_url():
    client = make_client(FakeSession([]))

    assert client.get_stream_url('track-1') == (
        f'{HOST}/Audio/track-1/stream?static=true&api_key={API_KEY}'
    )


def test_get_coverart_bytes():
    session = FakeSession([FakeResponse(content=b'image-bytes')])
    client = make_client(session)

    assert client.get_coverart_bytes('track-1', max_size=300) == b'image-bytes'
    _, url, params, _ = session.calls[0]
    assert url == f'{HOST}/Items/track-1/Images/Primary?maxHeight=300&maxWidth=300'


def test_request_exception_propagates_from_catalog():
    session = FakeSession([requests.ConnectionError('offline')])
    client = make_client(session)

    with pytest.raises(requests.RequestException):
        client.get_albums()


def test_close_closes_session():
    session = FakeSession([])
    client = make_client(session)

    client.close()

    assert session.calls[-1][0] == 'CLOSE'


def test_auth_header_sent_on_every_request():
    session = FakeSession([FakeResponse({'Items': []})])
    make_client(session)

    assert session.headers['X-Emby-Token'] == API_KEY
    assert session.headers['X-Emby-Client'] == 'Phoniebox'
    assert session.headers['X-Emby-Device-Id'] == 'phoniebox'


def test_host_trailing_slash_is_stripped():
    session = FakeSession([FakeResponse({'Items': []})])
    client = JellyfinApiClient(f'{HOST}/', API_KEY, session=session)

    assert client.host == HOST
