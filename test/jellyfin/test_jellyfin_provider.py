"""Tests for JellyfinMediaProvider."""
import pytest
from unittest import mock
from jukebox.mediaprovider import MediaProvider
from components.jellyfin.jellyfin_provider import JellyfinMediaProvider


class _MockMpdBackend(MediaProvider):
    """Minimal mock MPD provider for testing delegation."""

    def __init__(self):
        super().__init__()
        self._calls = []

    def initialize(self):
        pass

    def shutdown(self):
        pass

    def status(self):
        return {}

    def get_current_song(self):
        return None

    def play(self):
        self._calls.append('play')

    def stop(self):
        self._calls.append('stop')

    def pause(self, state=1):
        self._calls.append(('pause', state))

    def toggle(self):
        self._calls.append('toggle')

    def next(self):
        self._calls.append('next')

    def prev(self):
        self._calls.append('prev')

    def seek(self, new_time):
        self._calls.append(('seek', new_time))

    def rewind(self):
        self._calls.append('rewind')

    def play_folder(self, folder, recursive=False):
        self._calls.append(('play_folder', folder, recursive))

    def play_single(self, song_url):
        self._calls.append(('play_single', song_url))

    def play_album(self, albumartist, album):
        self._calls.append(('play_album', albumartist, album))

    def clear_playlist(self):
        self._calls.append('clear_playlist')

    def add_to_playlist(self, song_url):
        self._calls.append(('add_to_playlist', song_url))

    def playlistinfo(self):
        return []

    def list_albums(self):
        return []

    def get_folder_content(self, folder):
        return []

    def list_all_dirs(self):
        return []

    def get_single_coverart(self, song_url):
        return None

    def get_album_coverart(self, albumartist, album):
        return None

    def update(self):
        pass

    def update_wait(self):
        pass

    def get_player_type_and_version(self):
        return "mpd-test"


class TestJellyfinProviderConstruction:
    """Tests for object construction."""

    def test_stores_mpd_backend(self):
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        assert provider._mpd is mpd
        assert provider._api is None

    def test_inherits_play_card(self):
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        # The inherited play_card from MediaProvider is used
        assert type(provider).play_card is MediaProvider.play_card


class TestInitialize:
    """Tests for initialize()."""

    def test_raises_on_missing_host(self, monkeypatch):
        """initialize() raises ValueError when jellyfin.host is empty."""
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        from jukebox.cfghandler import get_handler
        cfg = get_handler('jukebox')
        cfg.setn('jellyfin', 'host', value='')
        cfg.setn('jellyfin', 'api_key', value='test-key')
        with pytest.raises(ValueError, match="host"):
            provider.initialize()

    def test_raises_on_no_auth(self, monkeypatch):
        """initialize() raises ValueError when no auth method is set."""
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        from jukebox.cfghandler import get_handler
        cfg = get_handler('jukebox')
        cfg.setn('jellyfin', 'host', value='http://jellyfin:8096')
        cfg.setn('jellyfin', 'api_key', value='')
        cfg.setn('jellyfin', 'username', value='')
        cfg.setn('jellyfin', 'password', value='')
        with pytest.raises(ValueError, match="must set either"):
            provider.initialize()

    def test_creates_client_with_api_key_and_authenticates(
        self, monkeypatch,
    ):
        """initialize() creates API client with api_key and calls
        authenticate()."""
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        from jukebox.cfghandler import get_handler
        cfg = get_handler('jukebox')
        cfg.setn('jellyfin', 'host', value='http://jellyfin:8096')
        cfg.setn('jellyfin', 'api_key', value='test-key')
        cfg.setn('jellyfin', 'username', value='')
        cfg.setn('jellyfin', 'password', value='')
        with mock.patch(
            'components.jellyfin.jellyfin_api_client.JellyfinApiClient',
        ) as mock_client_cls:
            mock_client = mock.Mock()
            mock_client_cls.return_value = mock_client
            provider.initialize()
            mock_client_cls.assert_called_once_with(
                'http://jellyfin:8096',
                api_key='test-key', username='', password='',
            )
            mock_client.authenticate.assert_called_once()

    def test_creates_client_with_credentials(
        self, monkeypatch,
    ):
        """initialize() creates API client with username+password."""
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        from jukebox.cfghandler import get_handler
        cfg = get_handler('jukebox')
        cfg.setn('jellyfin', 'host', value='http://jellyfin:8096')
        cfg.setn('jellyfin', 'api_key', value='')
        cfg.setn('jellyfin', 'username', value='user1')
        cfg.setn('jellyfin', 'password', value='pass1')
        with mock.patch(
            'components.jellyfin.jellyfin_api_client.JellyfinApiClient',
        ) as mock_client_cls:
            mock_client = mock.Mock()
            mock_client_cls.return_value = mock_client
            provider.initialize()
            mock_client_cls.assert_called_once_with(
                'http://jellyfin:8096',
                api_key='', username='user1', password='pass1',
            )
            mock_client.authenticate.assert_called_once()


class TestPlayFolder:
    """Tests for play_folder()."""

    def test_builds_playlist_from_audio_items(self):
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        mock_api = mock.Mock()
        mock_api.get_items_in_folder.return_value = [
            {'Id': 't1', 'Type': 'Audio'},
            {'Id': 't2', 'Type': 'Video'},
            {'Id': 't3', 'Type': 'Audio'},
        ]
        mock_api.get_stream_url.side_effect = [
            'http://jellyfin/Audio/t1/stream',
            'http://jellyfin/Audio/t3/stream',
        ]
        provider._api = mock_api

        provider.play_folder('folder-1')

        # Video item should be filtered out
        expected_playlist = [
            'http://jellyfin/Audio/t1/stream',
            'http://jellyfin/Audio/t3/stream',
        ]
        assert mock_api.get_items_in_folder.called
        calls = mpd._calls
        assert calls[0] == 'stop'
        assert calls[1] == 'clear_playlist'
        assert calls[2] == ('add_to_playlist', expected_playlist[0])
        assert calls[3] == ('add_to_playlist', expected_playlist[1])
        assert calls[4] == 'play'

    def test_no_audio_items(self):
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        mock_api = mock.Mock()
        mock_api.get_items_in_folder.return_value = [
            {'Id': 'v1', 'Type': 'Video'},
        ]
        provider._api = mock_api

        provider.play_folder('empty-folder')

        # Should not attempt playback
        assert 'play' not in mpd._calls


class TestPlaySingle:
    """Tests for play_single()."""

    def test_adds_stream_url_and_plays(self):
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        mock_api = mock.Mock()
        mock_api.get_stream_url.return_value = (
            'http://jellyfin/Audio/single/stream'
        )
        provider._api = mock_api

        provider.play_single('song-id')

        calls = mpd._calls
        assert calls[0] == 'stop'
        assert calls[1] == 'clear_playlist'
        assert calls[2] == (
            'add_to_playlist', 'http://jellyfin/Audio/single/stream',
        )
        assert calls[3] == 'play'


class TestPlayAlbum:
    """Tests for play_album()."""

    def test_delegates_to_play_folder_on_match(self):
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        mock_api = mock.Mock()
        mock_api.get_albums.return_value = [
            {'Id': 'a1', 'Name': 'Album One'},
            {'Id': 'a2', 'Name': 'My Album'},
        ]
        # For play_folder delegation
        mock_api.get_items_in_folder.return_value = [
            {'Id': 't1', 'Type': 'Audio'},
        ]
        mock_api.get_stream_url.return_value = (
            'http://jellyfin/Audio/t1/stream'
        )
        provider._api = mock_api

        provider.play_album('Artist', 'My Album')

        # Should have called get_items_in_folder for album 'a2'
        mock_api.get_items_in_folder.assert_called_once_with(
            'a2', recursive=False,
        )

    def test_logs_warning_when_not_found(self):
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        mock_api = mock.Mock()
        mock_api.get_albums.return_value = []
        provider._api = mock_api

        provider.play_album('Artist', 'Missing Album')

        # Should not attempt playback
        assert 'play' not in mpd._calls


class TestShutdown:
    """Tests for shutdown()."""

    def test_closes_api_session(self):
        mpd = _MockMpdBackend()
        provider = JellyfinMediaProvider(mpd_backend=mpd)
        mock_api = mock.Mock()
        provider._api = mock_api

        provider.shutdown()

        mock_api.close.assert_called_once()
        assert provider._api is None


class TestDelegationToMpd:
    """Tests that playback + status methods delegate to MPD."""

    @pytest.fixture
    def provider(self):
        mpd = _MockMpdBackend()
        p = JellyfinMediaProvider(mpd_backend=mpd)
        # Need a mock API so list_albums etc. don't crash
        mock_api = mock.Mock()
        mock_api.get_albums.return_value = []
        mock_api.get_items_in_folder.return_value = []
        mock_api.get_views.return_value = []
        mock_api.get_coverart_url.return_value = None
        p._api = mock_api
        return p, mpd

    def test_play(self, provider):
        p, mpd = provider
        p.play()
        assert mpd._calls == ['play']

    def test_stop(self, provider):
        p, mpd = provider
        p.stop()
        assert mpd._calls == ['stop']

    def test_toggle(self, provider):
        p, mpd = provider
        p.toggle()
        assert mpd._calls == ['toggle']

    def test_next(self, provider):
        p, mpd = provider
        p.next()
        assert mpd._calls == ['next']

    def test_prev(self, provider):
        p, mpd = provider
        p.prev()
        assert mpd._calls == ['prev']

    def test_pause(self, provider):
        p, mpd = provider
        p.pause(1)
        assert mpd._calls == [('pause', 1)]

    def test_seek(self, provider):
        p, mpd = provider
        p.seek(42.0)
        assert mpd._calls == [('seek', 42.0)]

    def test_rewind(self, provider):
        p, mpd = provider
        p.rewind()
        assert mpd._calls == ['rewind']

    def test_clear_playlist(self, provider):
        p, mpd = provider
        p.clear_playlist()
        assert mpd._calls == ['clear_playlist']

    def test_add_to_playlist(self, provider):
        p, mpd = provider
        p.add_to_playlist('some-url')
        assert mpd._calls == [('add_to_playlist', 'some-url')]

    def test_status(self, provider):
        p, mpd = provider
        result = p.status()
        assert result == {}

    def test_get_current_song(self, provider):
        p, mpd = provider
        result = p.get_current_song()
        assert result is None

    def test_playlistinfo(self, provider):
        p, mpd = provider
        result = p.playlistinfo()
        assert result == []

    def test_get_player_type_and_version(self, provider):
        p, mpd = provider
        result = p.get_player_type_and_version()
        assert 'jellyfin' in result
        assert 'mpd-test' in result


class TestPlugsTag:
    """Tests that all RPC-callable methods have @plugs.tag applied."""

    @pytest.fixture
    def provider(self):
        mpd = _MockMpdBackend()
        return JellyfinMediaProvider(mpd_backend=mpd)

    rpc_methods = [
        'play', 'stop', 'next', 'prev', 'toggle', 'pause', 'seek',
        'rewind', 'play_folder', 'play_single', 'play_album',
        'clear_playlist', 'add_to_playlist', 'status',
        'get_current_song', 'playlistinfo', 'list_albums',
        'get_folder_content', 'list_all_dirs',
        'get_single_coverart', 'get_album_coverart',
        'update', 'update_wait', 'get_player_type_and_version',
    ]

    @pytest.mark.parametrize("method_name", rpc_methods)
    def test_method_has_plugs_tag(self, provider, method_name):
        """Each RPC-callable method must have plugs_callable=True."""
        method = getattr(provider, method_name)
        assert getattr(method.__func__, 'plugs_callable', False) is True, (
            f"{method_name} is not decorated with @plugs.tag"
        )

    def test_methods_are_tagged(self, provider):
        """Non-overridden methods (like play_card) must also be callable."""
        # play_card is inherited from MediaProvider and already tagged
        assert getattr(provider.play_card, 'plugs_callable', False) is True
