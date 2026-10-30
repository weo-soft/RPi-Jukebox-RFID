# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder
"""
Debouncing and the per-button state machine for the MCP23017 buttons.

The controller has no thread of its own: :meth:`ButtonController.poll` is
called with a monotonic timestamp, so the timing can be tested with a fake
clock and without sleeping.
"""

import logging
import time
from typing import Callable, Dict, Optional, Sequence

from .config import ButtonConfig

logger = logging.getLogger('jb.mcp23017')

IDLE = 'idle'
PRESSED = 'pressed'
LONG_FIRED = 'long_fired'


class _ButtonRuntime:
    def __init__(self, button: ButtonConfig):
        self.button = button
        self.stable: Optional[int] = None
        self.last_raw: Optional[int] = None
        self.raw_since = 0.0
        self.pressed = False
        self.armed = True
        self.initialized = False
        self.state = IDLE
        self.pressed_at = 0.0
        self.long_fired = False
        self.next_repeat = 0.0


class ButtonController:
    """Poll the configured lines and turn level changes into actions."""

    def __init__(self, buttons: Sequence[ButtonConfig],
                 read_pin: Callable[[int], int],
                 bindings: Dict[str, Dict[str, Callable[[], object]]],
                 clock: Callable[[], float] = time.monotonic):
        self._clock = clock
        self._read_pin = read_pin
        self._bindings = bindings
        self._runtimes = [_ButtonRuntime(button) for button in buttons if button.valid]

    @property
    def states(self) -> Dict[str, str]:
        """Return the current state name per valid button."""
        return {runtime.button.name: runtime.state for runtime in self._runtimes}

    def poll(self, now: float) -> None:
        """Read all valid buttons and advance their state machines."""
        for runtime in self._runtimes:
            self._poll_button(runtime, now)

    def close(self) -> None:
        """Drop the runtime state."""
        self._runtimes = []

    def _poll_button(self, runtime: _ButtonRuntime, now: float) -> None:
        raw = self._read_pin(runtime.button.pin)
        if runtime.last_raw is None or raw != runtime.last_raw:
            runtime.last_raw = raw
            runtime.raw_since = now
        if now - runtime.raw_since < runtime.button.debounce_seconds:
            return
        if runtime.stable == raw:
            self._poll_timing(runtime, now)
            return
        runtime.stable = raw
        pressed = (raw == 0) if runtime.button.active_low else (raw == 1)
        if not runtime.initialized:
            runtime.initialized = True
            runtime.pressed = pressed
            runtime.state = PRESSED if pressed else IDLE
            runtime.armed = not pressed
            runtime.pressed_at = now
            return
        if pressed == runtime.pressed:
            return
        runtime.pressed = pressed
        if pressed:
            self._on_press(runtime, now)
        else:
            self._on_release(runtime, now)

    def _poll_timing(self, runtime: _ButtonRuntime, now: float) -> None:
        if not runtime.pressed or not runtime.armed:
            return
        button = runtime.button
        if button.type in ('long_press', 'short_long_press'):
            if not runtime.long_fired and now - runtime.pressed_at >= button.hold_seconds:
                runtime.long_fired = True
                runtime.state = LONG_FIRED
                self._fire(runtime, 'on_long_press')
        elif button.type == 'hold_repeat':
            if now >= runtime.next_repeat:
                due = runtime.next_repeat
                self._fire(runtime, 'on_press')
                runtime.next_repeat = due + button.hold_seconds

    def _on_press(self, runtime: _ButtonRuntime, now: float) -> None:
        button = runtime.button
        runtime.armed = True
        runtime.pressed_at = now
        runtime.long_fired = False
        runtime.state = PRESSED
        if button.type in ('momentary', 'hold_repeat'):
            self._fire(runtime, 'on_press')
        if button.type == 'hold_repeat':
            runtime.next_repeat = now + button.hold_seconds

    def _on_release(self, runtime: _ButtonRuntime, now: float) -> None:
        button = runtime.button
        if button.type == 'short_long_press' and runtime.armed and not runtime.long_fired:
            self._fire(runtime, 'on_short_press')
        runtime.state = IDLE
        runtime.long_fired = False
        runtime.pressed = False

    def _fire(self, runtime: _ButtonRuntime, key: str) -> None:
        function = self._bindings.get(runtime.button.name, {}).get(key)
        if function is None:
            return
        try:
            function()
        except Exception as error:
            logger.error("Action '%s' of button '%s' failed: %s: %s", key,
                         runtime.button.name, error.__class__.__name__, error)
