"""Interaction sources that reset the display inactivity timers.

RFID scans, touch events and configured key devices call
:meth:`ActivityMonitor.interaction`.  Player status changes are forwarded to
the state machine without counting as an interaction.  The WebApp reaches the
same entry point through the ``display.activity`` RPC call.
"""

import logging
import select
import threading
from time import monotonic

import evdev
import zmq
from components.controls.common.evdev_listener import EvDevKeyListener, find_device
from jukebox.publishing.subscriber import Subscriber

logger = logging.getLogger('jb.display.activity')

THROTTLE_SECONDS = 1.0
ERROR_NO_INPUT = 'no_input_access'
SUBSCRIBER_TIMEOUT_MS = 200
TOUCH_POLL_SECONDS = 0.2


class ActivityMonitor:
    """Collect interaction sources and throttle timer resets."""

    def __init__(
            self,
            state_machine,
            touch_device='',
            button_devices=None,
            clock=monotonic,
            subscriber_factory=Subscriber,
            input_device_factory=evdev.InputDevice,
            key_listener_factory=EvDevKeyListener):
        self._state_machine = state_machine
        self._touch_device_name = touch_device or ''
        self._button_devices = list(button_devices or [])
        self._clock = clock
        self._subscriber_factory = subscriber_factory
        self._input_device_factory = input_device_factory
        self._key_listener_factory = key_listener_factory

        self._lock = threading.RLock()
        self._stopped = threading.Event()
        self._errors = set()
        self._last_interaction = -THROTTLE_SECONDS
        self._last_tracking_id = -1
        self._subscriber = None
        self._touch_device = None
        self._threads = []
        self._button_listeners = []

    @property
    def errors(self):
        """Return the input-related error codes."""
        with self._lock:
            return sorted(self._errors)

    def start(self):
        """Start the subscriber, touch and button listeners."""
        self._start_subscriber()
        self._start_touch()
        self._start_buttons()

    def stop(self):
        """Stop all listeners and close their devices."""
        self._stopped.set()
        subscriber = self._subscriber
        if subscriber is not None:
            try:
                subscriber.socket.close(linger=0)
            except Exception:
                logger.debug('Could not close the activity subscriber', exc_info=True)
        touch_device = self._touch_device
        if touch_device is not None:
            try:
                touch_device.close()
            except Exception:
                logger.debug('Could not close the touch device', exc_info=True)
        for listener in self._button_listeners:
            listener.stop()
        for thread in self._threads:
            if thread is not threading.current_thread() and thread.is_alive():
                thread.join(timeout=1)

    def interaction(self):
        """Reset the inactivity timers, throttled to one reset per second."""
        now = self._clock()
        with self._lock:
            if now - self._last_interaction < THROTTLE_SECONDS:
                return
            self._last_interaction = now
        self._state_machine.interaction()

    def _add_error(self, code):
        with self._lock:
            self._errors.add(code)

    def _start_subscriber(self):
        thread = threading.Thread(
            target=self._subscriber_loop,
            name='display-activity',
            daemon=True,
        )
        self._threads.append(thread)
        thread.start()

    def _subscriber_loop(self):
        subscriber = self._subscribe()
        if subscriber is None:
            return
        self._subscriber = subscriber
        self._set_subscriber_timeout(subscriber)
        try:
            self._receive_loop(subscriber)
        finally:
            self._close_subscriber(subscriber)

    def _subscribe(self):
        try:
            return self._subscriber_factory(
                'inproc://PublisherToProxy',
                topics=['rfid.card_id', 'playerstatus'],
            )
        except Exception as error:
            logger.warning(
                'Could not subscribe to display activity events: %s',
                error,
            )
            return None

    @staticmethod
    def _set_subscriber_timeout(subscriber):
        try:
            subscriber.socket.setsockopt(zmq.RCVTIMEO, SUBSCRIBER_TIMEOUT_MS)
        except zmq.ZMQError:
            logger.debug('Could not set the subscriber timeout', exc_info=True)

    @staticmethod
    def _close_subscriber(subscriber):
        try:
            subscriber.socket.close(linger=0)
        except Exception:
            logger.debug('Could not close the activity subscriber', exc_info=True)

    def _receive_loop(self, subscriber):
        while not self._stopped.is_set():
            try:
                topic, message = subscriber.receive()
            except zmq.Again:
                continue
            except zmq.ZMQError as error:
                if self._stopped.is_set():
                    return
                logger.warning('Display activity subscriber failed: %s', error)
                return
            except Exception as error:
                logger.warning('Display activity message failed: %s', error)
                continue
            try:
                self._dispatch(topic, message)
            except Exception as error:
                logger.warning('Display activity dispatch failed: %s', error)

    def _dispatch(self, topic, message):
        if topic.endswith('.card_id'):
            self.interaction()
            return
        if topic == 'playerstatus' and isinstance(message, dict):
            state = message.get('state')
            if isinstance(state, str):
                self._state_machine.on_player_state(state)

    def _start_touch(self):
        if self._stopped.is_set():
            return
        try:
            device = self._open_touch_device()
        except PermissionError:
            self._add_error(ERROR_NO_INPUT)
            logger.warning(
                'No permission to open an input device; touch will not wake '
                'the display',
            )
            return
        if device is None:
            return
        self._touch_device = device
        thread = threading.Thread(
            target=self._touch_loop,
            args=(device,),
            name='display-touch',
            daemon=True,
        )
        self._threads.append(thread)
        thread.start()

    def _open_touch_device(self):
        for path in evdev.list_devices():
            try:
                device = self._input_device_factory(path)
            except PermissionError:
                raise
            except OSError as error:
                logger.debug('Could not open input device %s: %s', path, error)
                continue
            if self._matches_touch(device):
                return device
            device.close()
        logger.info('No touch device found for the display plugin')
        return None

    def _matches_touch(self, device):
        if self._touch_device_name and self._touch_device_name not in device.name:
            return False
        return self._is_touch_device(device)

    @staticmethod
    def _is_touch_device(device):
        capabilities = device.capabilities()
        if evdev.ecodes.EV_ABS not in capabilities:
            return False
        codes = {code for code, _ in capabilities[evdev.ecodes.EV_ABS]}
        return (
            evdev.ecodes.ABS_X in codes
            or evdev.ecodes.ABS_MT_POSITION_X in codes
        )

    def _touch_loop(self, device):
        while not self._stopped.is_set():
            try:
                readable, _, _ = select.select(
                    [device],
                    [],
                    [],
                    TOUCH_POLL_SECONDS,
                )
            except (OSError, ValueError):
                break
            if not readable:
                continue
            try:
                events = list(device.read())
            except (OSError, BlockingIOError):
                break
            for event in events:
                self._handle_touch_event(event)

    def _handle_touch_event(self, event):
        if event.type == evdev.ecodes.EV_KEY:
            if (
                    event.code == evdev.ecodes.BTN_TOUCH
                    and event.value == 1):
                self.interaction()
            return
        if (
                event.type == evdev.ecodes.EV_ABS
                and event.code == evdev.ecodes.ABS_MT_TRACKING_ID):
            if event.value >= 0 and self._last_tracking_id < 0:
                self.interaction()
            self._last_tracking_id = event.value

    def _start_buttons(self):
        for name in self._button_devices:
            if not name:
                continue
            try:
                codes = self._key_codes(name)
            except PermissionError:
                self._add_error(ERROR_NO_INPUT)
                logger.warning(
                    'No permission to open button device %r',
                    name,
                )
                continue
            except (FileNotFoundError, AttributeError) as error:
                logger.warning(
                    'Configured button device %r not found: %s',
                    name,
                    error,
                )
                continue
            if not codes:
                logger.warning(
                    'Configured button device %r exposes no key events',
                    name,
                )
                continue
            listener = self._key_listener_factory(
                name,
                False,
                f'display-button-{name}',
            )
            listener.button_callbacks = {
                code: self.interaction for code in codes
            }
            listener.start()
            self._button_listeners.append(listener)

    def _key_codes(self, name):
        path = find_device(name, exact_name=False)
        device = self._input_device_factory(path)
        try:
            return list(device.capabilities().get(evdev.ecodes.EV_KEY, []))
        finally:
            device.close()
