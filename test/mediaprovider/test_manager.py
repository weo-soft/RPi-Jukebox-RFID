"""Tests for MediaProviderManager singleton and provider registration."""

import pytest
from jukebox.mediaprovider import MediaProvider, get_manager
from jukebox.mediaprovider.manager import MediaProviderManager


class _MockProvider(MediaProvider):
    """Minimal concrete provider for testing."""
    def initialize(self):
        pass

    def shutdown(self):
        pass

    def status(self):
        return {}

    def get_current_song(self):
        return None

    def play(self):
        pass

    def stop(self):
        pass

    def pause(self, state: int = 1):
        pass

    def toggle(self):
        pass

    def next(self):
        pass

    def prev(self):
        pass

    def seek(self, new_time: float):
        pass

    def rewind(self):
        pass

    def play_folder(self, folder: str, recursive: bool = False):
        pass

    def play_single(self, song_url: str):
        pass

    def play_album(self, albumartist: str, album: str):
        pass

    def clear_playlist(self):
        pass

    def add_to_playlist(self, song_url: str):
        pass

    def playlistinfo(self):
        return []

    def list_albums(self):
        return []

    def get_folder_content(self, folder: str):
        return []

    def list_all_dirs(self):
        return []

    def get_single_coverart(self, song_url: str):
        return None

    def get_album_coverart(self, albumartist: str, album: str):
        return None

    def update(self):
        pass

    def update_wait(self):
        pass

    def get_player_type_and_version(self):
        return "mock"


@pytest.fixture(autouse=True)
def _reset_manager():
    """Reset singleton state between tests to avoid cross-test interference."""
    # Create a new manager instance to wipe state
    import jukebox.mediaprovider.manager as mgr_module
    mgr_module._manager_instance = mgr_module.MediaProviderManager()


@pytest.fixture
def manager():
    """Return the singleton manager (reset by _reset_manager)."""
    return get_manager()


class TestManagerSingleton:
    def test_singleton(self):
        """get_manager() returns the same instance."""
        m1 = get_manager()
        m2 = get_manager()
        assert m1 is m2

    def test_instance_type(self, manager):
        assert isinstance(manager, MediaProviderManager)


class TestProviderRegistration:
    def test_register_and_resolve(self, manager):
        mpd = _MockProvider()
        manager.register_provider('mpd', mpd)
        assert manager.resolve('mpd') is mpd

    def test_register_multiple(self, manager):
        mpd = _MockProvider()
        jellyfin = _MockProvider()
        manager.register_provider('mpd', mpd)
        manager.register_provider('jellyfin', jellyfin)
        assert manager.resolve('mpd') is mpd
        assert manager.resolve('jellyfin') is jellyfin

    def test_set_default(self, manager):
        mpd = _MockProvider()
        manager.register_provider('mpd', mpd)
        manager.set_default('mpd')
        assert manager.get_default() == 'mpd'
        assert manager.resolve() is mpd

    def test_set_default_unregistered_raises(self, manager):
        with pytest.raises(KeyError, match="not registered"):
            manager.set_default('nonexistent')

    def test_resolve_unknown_raises_keyerror(self, manager):
        manager.register_provider('mpd', _MockProvider())
        with pytest.raises(KeyError):
            manager.resolve('jellyfin')

    def test_resolve_no_default_raises_runtimeerror(self, manager):
        with pytest.raises(RuntimeError, match="No media provider"):
            manager.resolve()

    def test_list_providers(self, manager):
        manager.register_provider('mpd', _MockProvider())
        manager.register_provider('jellyfin', _MockProvider())
        providers = manager.list_providers()
        assert 'mpd' in providers
        assert 'jellyfin' in providers

    def test_get_provider(self, manager):
        mpd = _MockProvider()
        manager.register_provider('mpd', mpd)
        assert manager.get_provider('mpd') is mpd


class TestSecondSwipeAttributes:
    def test_last_played_folder_roundtrip(self, manager):
        manager.set_last_played_folder('TestFolder')
        assert manager.get_last_played_folder() == 'TestFolder'

    def test_last_played_folder_default_empty(self, manager):
        assert manager.get_last_played_folder() == ''

    def test_second_swipe_action_roundtrip(self, manager):
        def dummy_action():
            return 42

        manager.set_second_swipe_action(dummy_action)
        assert manager.get_second_swipe_action() is dummy_action
        assert manager.get_second_swipe_action()() == 42

    def test_second_swipe_action_default_none(self, manager):
        assert manager.get_second_swipe_action() is None

    def test_persist_callback_called(self, manager):
        persisted = []

        def cb(folder):
            persisted.append(folder)

        manager.set_persist_callback(cb)
        manager.set_last_played_folder('MyFolder')
        manager.persist_last_played_folder()
        assert persisted == ['MyFolder']

    def test_persist_without_callback_no_error(self, manager):
        manager.set_last_played_folder('Folder')
        # Should not raise
        manager.persist_last_played_folder()


class TestPlayCardCallbacks:
    def test_set_and_get_callbacks(self, manager):
        fake_callbacks = object()
        manager.set_play_card_callbacks(fake_callbacks)
        assert manager.get_play_card_callbacks() is fake_callbacks

    def test_get_callbacks_before_set_raises(self, manager):
        with pytest.raises(RuntimeError, match="not yet injected"):
            manager.get_play_card_callbacks()

    def test_play_card_states_after_set(self, manager):
        fake_callbacks = object()
        manager.set_play_card_callbacks(fake_callbacks)
        from jukebox.callingback import PlayCardState
        assert manager.get_play_card_state_first() is PlayCardState.firstSwipe
        assert manager.get_play_card_state_second() is PlayCardState.secondSwipe