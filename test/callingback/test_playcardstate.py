"""Tests for PlayCardState enum in jukebox.callingback."""

import pytest
from jukebox.callingback import PlayCardState


def test_playcardstate_values():
    """Verify enum values are as expected."""
    assert PlayCardState.firstSwipe.value == 0
    assert PlayCardState.secondSwipe.value == 1


mpd_available = False
try:
    import mpd  # noqa: F401
    mpd_available = True
except ImportError:
    pass


@pytest.mark.skipif(not mpd_available, reason="mpd module not available")
def test_playcardstate_re_exported_from_playcontentcallback():
    """Backward compat: playcontentcallback module re-exports PlayCardState
    from callingback without defining its own class."""
    import components.playermpd.playcontentcallback as pcc
    assert hasattr(pcc, 'PlayCardState')
    assert pcc.PlayCardState is PlayCardState


def test_playcardstate_comparison():
    """Enum values can be compared for identity."""
    assert PlayCardState.firstSwipe is PlayCardState.firstSwipe
    assert PlayCardState.secondSwipe is PlayCardState.secondSwipe
    assert PlayCardState.firstSwipe is not PlayCardState.secondSwipe