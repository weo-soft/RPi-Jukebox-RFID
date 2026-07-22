"""Tests for PlayCardState enum in jukebox.callingback."""

from jukebox.callingback import PlayCardState


def test_playcardstate_values():
    """Verify enum values are as expected."""
    assert PlayCardState.firstSwipe.value == 0
    assert PlayCardState.secondSwipe.value == 1


def test_playcardstate_importable_from_playcontentcallback():
    """Backward compat: PlayCardState is re-exported from playcontentcallback."""
    from components.playermpd.playcontentcallback import PlayCardState as PCS2
    assert PCS2 is PlayCardState


def test_playcardstate_comparison():
    """Enum values can be compared for identity."""
    assert PlayCardState.firstSwipe is PlayCardState.firstSwipe
    assert PlayCardState.secondSwipe is PlayCardState.secondSwipe
    assert PlayCardState.firstSwipe is not PlayCardState.secondSwipe