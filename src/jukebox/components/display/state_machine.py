"""Display state machine: active, dimmed and standby transitions.

The machine owns the two inactivity deadlines.  Both are absolute deadlines
measured from the last interaction, so ``dim_timeout_min: 2`` and
``standby_timeout_min: 5`` mean five minutes of inactivity in total.  The
driver is responsible for the actual brightness and power writes; this module
only decides which state is active and persists the user settings.
"""

import logging
import threading
from time import monotonic

from jukebox.multitimer import GenericTimerClass

logger = logging.getLogger('jb.display.state_machine')

STATE_ACTIVE = 'active'
STATE_DIMMED = 'dimmed'
STATE_STANDBY = 'standby'

MUSIC_MODES = ('normal', 'on_while_playing', 'dim_while_playing')
STANDBY_MECHANICS = ('auto', 'backlight', 'power_off')

SUPPRESSION_SECONDS = 1.0
MAX_TIMEOUT_MIN = 1440


class DisplayStateMachine:
    """Coordinate brightness, inactivity timers and music-dependent states."""

    def __init__(
            self,
            cfg,
            driver,
            publish=None,
            clock=monotonic,
            timer_factory=None):
        self._cfg = cfg
        self._driver = driver
        self._publish_callback = publish
        self._clock = clock
        self._lock = threading.RLock()
        self._timer_factory = timer_factory or self._default_timer

        self._brightness = self._read_int('brightness', 100, 1, 100)
        self._dim_brightness = self._read_int('dim_brightness', 10, 0, 100)
        self._dim_timeout = self._read_int('dim_timeout_min', 2, 0, MAX_TIMEOUT_MIN)
        self._standby_timeout = self._read_int(
            'standby_timeout_min',
            5,
            0,
            MAX_TIMEOUT_MIN,
        )
        if 0 < self._standby_timeout < self._dim_timeout:
            logger.warning(
                'display.standby_timeout_min (%s) is smaller than '
                'display.dim_timeout_min (%s); raising it to the dim timeout',
                self._standby_timeout,
                self._dim_timeout,
            )
            self._standby_timeout = self._dim_timeout
        self._music_mode = self._read_choice(
            'music_mode',
            'normal',
            MUSIC_MODES,
        )
        self._mechanic = self._read_choice(
            'standby_mechanic',
            'auto',
            STANDBY_MECHANICS,
        )

        self._state = STATE_ACTIVE
        self._playing = False
        self._player_state = None
        self._last_interaction = self._clock()
        self._suppress_until = 0.0

        self._dim_timer = self._timer_factory(
            'display.dim',
            max(0.0, self._dim_timeout * 60),
            self._on_dim_timer,
        )
        self._standby_timer = self._timer_factory(
            'display.standby',
            max(0.0, self._standby_timeout * 60),
            self._on_standby_timer,
        )
        self._arm_timers()

    @staticmethod
    def _default_timer(name, seconds, callback):
        return GenericTimerClass(name, seconds, callback)

    def _read_int(self, key, default, minimum, maximum):
        value = self._cfg.getn('display', key, default=default)
        if isinstance(value, bool) or not isinstance(value, int):
            logger.warning(
                'display.%s must be an integer; using %s',
                key,
                default,
            )
            return default
        if value < minimum or value > maximum:
            logger.warning(
                'display.%s=%s is outside %s..%s; clamping',
                key,
                value,
                minimum,
                maximum,
            )
            return max(minimum, min(maximum, value))
        return value

    def _read_choice(self, key, default, choices):
        value = self._cfg.getn('display', key, default=default)
        if value not in choices:
            logger.warning(
                'display.%s=%r is not one of %s; using %r',
                key,
                value,
                choices,
                default,
            )
            return default
        return value

    def _arm_timers(self):
        now = self._clock()
        self._arm_timer(self._dim_timer, self._dim_timeout, now)
        self._arm_timer(self._standby_timer, self._standby_timeout, now)

    def _arm_timer(self, timer, minutes, now):
        if minutes <= 0:
            timer.cancel()
            return
        delay = max(0.0, self._last_interaction + minutes * 60 - now)
        timer.start(delay, restart=True)

    def _on_dim_timer(self):
        with self._lock:
            if self._state != STATE_ACTIVE or self._dim_timeout <= 0:
                return
            if self._transitions_suppressed('dim'):
                return
            self._enter_dimmed_locked()

    def _on_standby_timer(self):
        with self._lock:
            if self._state == STATE_STANDBY or self._standby_timeout <= 0:
                return
            if self._transitions_suppressed('standby'):
                return
            self._enter_standby_locked()

    def _transitions_suppressed(self, kind):
        if not self._playing:
            return False
        if self._music_mode == 'on_while_playing':
            return True
        if self._music_mode == 'dim_while_playing':
            return kind == 'standby'
        return False

    def _enter_dimmed_locked(self):
        if self._driver.brightness_source is None:
            return
        if self._state == STATE_STANDBY:
            return
        self._state = STATE_DIMMED
        self._driver.set_percent(self._dim_brightness)
        self._publish()

    def _enter_standby_locked(self):
        if self._state == STATE_STANDBY:
            return
        self._state = STATE_STANDBY
        self._driver.set_power(False)
        self._dim_timer.cancel()
        self._standby_timer.cancel()
        self._publish()

    def _wake_locked(self):
        if self._state == STATE_ACTIVE:
            return
        if (
                self._state == STATE_STANDBY
                and self._driver.resolve_standby_mechanic() == 'power_off'):
            self._driver.set_power(True)
        self._state = STATE_ACTIVE
        if self._driver.brightness_source is not None:
            self._driver.set_percent(self._brightness)
        self._publish()

    def _apply_active_locked(self):
        if (
                self._driver.power_path is not None
                and self._driver.resolve_standby_mechanic() == 'power_off'):
            self._driver.set_power(True)
        if self._driver.brightness_source is not None:
            self._driver.set_percent(self._brightness)

    def interaction(self):
        """Reset both deadlines and wake the panel when it is not active."""
        with self._lock:
            now = self._clock()
            if now < self._suppress_until:
                return
            self._last_interaction = now
            self._wake_locked()
            self._arm_timers()

    def set_power(self, on):
        """Switch the display on or off manually without persisting the state."""
        with self._lock:
            self._require_control()
            if not isinstance(on, bool):
                raise ValueError('on must be a boolean')
            now = self._clock()
            if on:
                self._last_interaction = now
                self._state = STATE_ACTIVE
                self._apply_active_locked()
                self._arm_timers()
            else:
                self._state = STATE_STANDBY
                self._driver.set_power(False)
                self._dim_timer.cancel()
                self._standby_timer.cancel()
            self._suppress_until = now + SUPPRESSION_SECONDS
            self._publish()

    def set_brightness(self, percent):
        """Set and persist the active brightness, waking the panel first."""
        with self._lock:
            self._require_control()
            self._require_brightness()
            value = self._validated_percent(percent, 1, 100)
            self._persist('brightness', value)
            self._brightness = value
            if self._state != STATE_ACTIVE:
                self._wake_locked()
                self._last_interaction = self._clock()
                self._arm_timers()
            self._driver.set_percent(value)
            self._publish()

    def set_dim_brightness(self, percent):
        """Set and persist the brightness of the dimmed stage."""
        with self._lock:
            self._require_control()
            value = self._validated_percent(percent, 0, 100)
            self._persist('dim_brightness', value)
            self._dim_brightness = value
            if self._state == STATE_DIMMED:
                self._driver.set_percent(value)
            self._publish()

    def set_timeouts(self, dim_min, standby_min):
        """Set and persist the two absolute inactivity deadlines."""
        with self._lock:
            self._require_control()
            dim_value = self._validated_minutes(dim_min, 'dim_min')
            standby_value = self._validated_minutes(standby_min, 'standby_min')
            if 0 < standby_value < dim_value:
                raise ValueError(
                    'standby_min must be 0 or at least dim_min',
                )
            self._persist_many({
                'dim_timeout_min': dim_value,
                'standby_timeout_min': standby_value,
            })
            self._dim_timeout = dim_value
            self._standby_timeout = standby_value
            if self._state == STATE_STANDBY:
                self._dim_timer.cancel()
                self._standby_timer.cancel()
            elif self._state == STATE_DIMMED:
                self._dim_timer.cancel()
                self._arm_timer(
                    self._standby_timer,
                    self._standby_timeout,
                    self._clock(),
                )
            else:
                self._arm_timers()
            self._publish()

    def set_music_mode(self, mode):
        """Set and persist the music-dependent transition policy."""
        with self._lock:
            self._require_control()
            if mode not in MUSIC_MODES:
                raise ValueError(f'mode must be one of {MUSIC_MODES}')
            self._persist('music_mode', mode)
            self._music_mode = mode
            self._apply_music_policy_locked()
            self._publish()

    def set_standby_mechanic(self, mechanic):
        """Set and persist the standby mechanic."""
        with self._lock:
            self._require_control()
            if mechanic not in STANDBY_MECHANICS:
                raise ValueError(
                    f'mechanic must be one of {STANDBY_MECHANICS}',
                )
            self._persist('standby_mechanic', mechanic)
            self._mechanic = mechanic
            self._driver.set_standby_mechanic(mechanic)
            self._publish()

    def on_player_state(self, state):
        """Apply the music policy for a player state change."""
        with self._lock:
            was_playing = self._playing
            self._player_state = state
            self._playing = state == 'play'
            if self._playing == was_playing:
                return
            if self._playing:
                if (
                        self._music_mode != 'normal'
                        and self._state != STATE_ACTIVE):
                    self._state = STATE_ACTIVE
                    self._apply_active_locked()
                    self._publish()
                self._arm_timers()
            else:
                self._evaluate_elapsed_locked()

    def _apply_music_policy_locked(self):
        if self._playing:
            if (
                    self._music_mode in ('on_while_playing', 'dim_while_playing')
                    and self._state != STATE_ACTIVE):
                self._state = STATE_ACTIVE
                self._apply_active_locked()
            self._arm_timers()
            return
        self._evaluate_elapsed_locked()

    def _evaluate_elapsed_locked(self):
        if self._state == STATE_STANDBY:
            return
        elapsed = self._clock() - self._last_interaction
        if (
                self._standby_timeout > 0
                and elapsed >= self._standby_timeout * 60):
            self._enter_standby_locked()
            return
        if self._dim_timeout > 0 and elapsed >= self._dim_timeout * 60:
            self._enter_dimmed_locked()
            return
        self._arm_timers()

    def _require_control(self):
        if (
                self._driver.brightness_source is None
                and self._driver.power_path is None):
            raise RuntimeError('no_display_control')

    def _require_brightness(self):
        if self._driver.brightness_source is None:
            raise RuntimeError('no_display_control')

    @staticmethod
    def _validated_percent(percent, minimum, maximum):
        if isinstance(percent, bool) or not isinstance(percent, int):
            raise ValueError('percent must be an integer')
        if percent < minimum or percent > maximum:
            raise ValueError(
                f'percent must be between {minimum} and {maximum}',
            )
        return percent

    @staticmethod
    def _validated_minutes(value, name):
        if isinstance(value, bool) or not isinstance(value, int):
            raise ValueError(f'{name} must be an integer')
        if value < 0 or value > MAX_TIMEOUT_MIN:
            raise ValueError(
                f'{name} must be between 0 and {MAX_TIMEOUT_MIN}',
            )
        return value

    def _persist(self, key, value):
        with self._cfg:
            previous = self._cfg.getn('display', key, default=None)
            self._cfg.setn('display', key, value=value)
            try:
                self._cfg.save(only_if_changed=True)
            except Exception as error:
                self._cfg.setn('display', key, value=previous)
                raise RuntimeError('config_save_failed') from error

    def _persist_many(self, values):
        with self._cfg:
            previous = {
                key: self._cfg.getn('display', key, default=None)
                for key in values
            }
            for key, value in values.items():
                self._cfg.setn('display', key, value=value)
            try:
                self._cfg.save(only_if_changed=True)
            except Exception as error:
                for key, value in previous.items():
                    self._cfg.setn('display', key, value=value)
                raise RuntimeError('config_save_failed') from error

    def _publish(self):
        if self._publish_callback is None:
            return
        try:
            self._publish_callback()
        except Exception as error:
            logger.warning('Display status publish failed: %s', error)

    def get_status(self):
        """Return the complete ``display.status`` payload."""
        with self._lock:
            status = {
                'state': self._state,
                'power': self._state != STATE_STANDBY,
                'brightness_percent': self._brightness,
                'dim_brightness_percent': self._dim_brightness,
                'dim_timeout_min': self._dim_timeout,
                'standby_timeout_min': self._standby_timeout,
                'music_mode': self._music_mode,
                'standby_mechanic': self._mechanic,
                'standby_mechanic_active': self._driver.resolve_standby_mechanic(),
            }
            status.update(self._driver.get_status())
            return status

    def close(self):
        """Cancel both inactivity timers."""
        with self._lock:
            self._dim_timer.cancel()
            self._standby_timer.cancel()
