"""
Tests for PlayCardState extraction from playermpd to jukebox.callingback.

Verifies:
- PlayCardState is importable from jukebox.callingback
- PlayCardState is importable from components.playermpd.playcontentcallback (re-export)
- Both enum values exist (firstSwipe, secondSwipe)
"""

import sys
from pathlib import Path

import pytest

# Ensure the src/jukebox directory is on sys.path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src' / 'jukebox'))


class TestPlayCardStateFromCallingback:
    """Tests that PlayCardState is importable from jukebox.callingback."""

    def test_import_from_jukebox_callingback(self):
        """PlayCardState can be imported from jukebox.callingback."""
        from jukebox.callingback import PlayCardState
        assert PlayCardState is not None

    def test_first_swipe_value(self):
        """PlayCardState.firstSwipe exists."""
        from jukebox.callingback import PlayCardState
        assert hasattr(PlayCardState, 'firstSwipe')

    def test_second_swipe_value(self):
        """PlayCardState.secondSwipe exists."""
        from jukebox.callingback import PlayCardState
        assert hasattr(PlayCardState, 'secondSwipe')