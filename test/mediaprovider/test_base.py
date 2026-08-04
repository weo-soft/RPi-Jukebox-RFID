"""Tests for MediaProvider base class play_card() behavior."""

from jukebox.mediaprovider import MediaProvider, get_manager


_full_env_available = False
try:
    import mpd  # noqa: F401
    _full_env_available = True
except ImportError:
    pass


class _MockMinimalProvider(MediaProvider):
    """Minimal provider that records play_folder calls."""
    def __init__(self):
        super().__init__()
        self.folders_played = []

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
        self.folders_played.append(folder)

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


class _FakeCallbacks:
    """Fake callbacks object with run_callbacks for testing."""
    def run_callbacks(self, folder, state):
        pass


def setup_manager():
    """Set up the manager with callbacks and second_swipe_action."""
    mgr = get_manager()
    mgr.set_play_card_callbacks(_FakeCallbacks())
    mgr.set_second_swipe_action(None)  # No second-swipe action
    mgr.set_last_played_folder('')
    return mgr


class TestPlayCardFirstSwipe:
    def test_first_swipe_delegates_to_play_folder(self):
        setup_manager()
        provider = _MockMinimalProvider()
        provider.play_card('AlbumX', recursive=False)
        assert 'AlbumX' in provider.folders_played

    def test_first_swipe_sets_last_played_folder(self):
        setup_manager()
        provider = _MockMinimalProvider()
        provider.play_card('NewAlbum', recursive=False)
        assert get_manager().get_last_played_folder() == 'NewAlbum'

    def test_different_folders_are_first_swipes(self):
        setup_manager()
        provider = _MockMinimalProvider()
        provider.play_card('Album1')
        provider.play_card('Album2')
        assert provider.folders_played == ['Album1', 'Album2']


class TestPlayCardSecondSwipe:
    def test_same_folder_triggers_second_swipe_action(self):
        """Second swipe calls second_swipe_action instead of
        play_folder."""
        action_calls = []

        def fake_action():
            action_calls.append(True)

        mgr = setup_manager()
        mgr.set_second_swipe_action(fake_action)

        provider = _MockMinimalProvider()
        provider.play_card('SameFolder')   # first swipe
        provider.play_card('SameFolder')   # second swipe

        # First swipe should have called play_folder
        assert provider.folders_played == ['SameFolder']
        # Second swipe should have called the action
        assert len(action_calls) == 1

    def test_same_folder_second_swipe_sets_last_played(self):
        action_calls = []

        def fake_action():
            action_calls.append(True)

        mgr = setup_manager()
        mgr.set_second_swipe_action(fake_action)

        provider = _MockMinimalProvider()
        provider.play_card('SameFolder')
        provider.play_card('SameFolder')

        # Last played still updated on second swipe
        assert mgr.get_last_played_folder() == 'SameFolder'

    def test_second_swipe_with_none_action_still_delegates(self):
        """When second_swipe_action is None, second swipe also
        delegates to play_folder."""
        setup_manager()
        provider = _MockMinimalProvider()
        provider.play_card('Folder')
        provider.play_card('Folder')
        # Both should call play_folder since no action is set
        assert provider.folders_played == ['Folder', 'Folder']


class TestPlayCardGlobalState:
    def test_state_shared_across_providers(self):
        """Last played folder is global, shared across provider
        instances."""
        setup_manager()

        provider_a = _MockMinimalProvider()
        provider_b = _MockMinimalProvider()

        provider_a.play_card('GlobalFolder')
        provider_b.play_card('GlobalFolder')

        # provider_a should have it as first swipe (1 call)
        assert provider_a.folders_played == ['GlobalFolder']
        # provider_b also detects it as second swipe if action is set
        # (action is None so it also calls play_folder)
        assert provider_b.folders_played == ['GlobalFolder']
        # Global state is updated
        assert get_manager().get_last_played_folder() == 'GlobalFolder'
