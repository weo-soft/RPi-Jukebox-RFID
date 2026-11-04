"""
ALSA wave jingle Service for jingle.JingleFactory
"""
import alsaaudio
import logging
import threading
import time
import wave
import os
import jukebox.cfghandler
import jukebox.plugs as plugin

logger = logging.getLogger('jb.alsaif')
cfg = jukebox.cfghandler.get_handler('jukebox')

# Additional time granted to a playback before it is considered stuck. The
# PipeWire ALSA plugin waits for a playback node without a timeout, so a device
# that is still initialising can block the calling thread for an arbitrarily
# long time. The margin covers opening the device and draining the buffer.
PLAYBACK_TIMEOUT_MARGIN = 10.0


# ---------------------------------------------------------------------------
# Jingle Service for WAVE by ALSA
# ---------------------------------------------------------------------------

@plugin.register
class AlsaWave:
    """Jingle Service for playing wave files directly from Python through ALSA"""
    fmt_lookup = {1: alsaaudio.PCM_FORMAT_U8,
                  2: alsaaudio.PCM_FORMAT_S16_LE,
                  3: alsaaudio.PCM_FORMAT_S24_3LE,
                  4: alsaaudio.PCM_FORMAT_S32_LE}

    @classmethod
    def _play_wave_core(cls, filename):
        with wave.open(filename, 'rb') as f:
            width = f.getsampwidth()
            if width not in AlsaWave.fmt_lookup:
                raise ValueError('Unsupported format')
            device_name = cfg.setndefault('alsawave', 'device', value='default')
            period_size = f.getframerate() // 8
            device = alsaaudio.PCM(channels=f.getnchannels(),
                                   rate=f.getframerate(),
                                   format=AlsaWave.fmt_lookup[width],
                                   periodsize=period_size,
                                   device=device_name)

            data = f.readframes(period_size)
            while data:
                device.write(data)
                data = f.readframes(period_size)

    @staticmethod
    def _playback_duration(filename):
        """Return the duration of the wave file in seconds"""
        with wave.open(filename, 'rb') as f:
            return f.getnframes() / f.getframerate()

    @plugin.tag
    def play(self, filename):
        """Play the wave file

        The playback runs in a worker thread so that a missing or unresponsive
        audio device cannot block the caller indefinitely. The caller waits for
        the expected playback duration plus :data:`PLAYBACK_TIMEOUT_MARGIN`.
        """
        if not (os.path.exists(filename) and os.path.isfile(filename)):
            logger.error(f"File does not exist: '{filename}'")
            raise KeyError(f"File does not exist: '{filename}'")

        try:
            timeout = AlsaWave._playback_duration(filename) + PLAYBACK_TIMEOUT_MARGIN
        except Exception as e:
            logger.error(f"Could not read '{filename}': {e.__class__.__name__}: {e}")
            timeout = PLAYBACK_TIMEOUT_MARGIN

        def playback():
            try:
                AlsaWave._play_wave_core(filename)
            except Exception as e:
                logger.error(f"{e.__class__.__name__}: {e}")

        logger.debug("Playing wave file")
        started = time.monotonic()
        worker = threading.Thread(target=playback, name='JinglePlayback', daemon=True)
        worker.start()
        worker.join(timeout)
        elapsed = time.monotonic() - started
        if worker.is_alive():
            logger.error(f"Playback did not complete within {timeout:.1f} s. "
                         f"Giving up: the audio device does not accept the stream")
        else:
            logger.debug(f"Playback finished after {elapsed:.2f} s")


class AlsaWaveBuilder:

    def __init__(self):
        """
        Builder instantiates AlsaWave during init and not during first call because
        we want AlsaWave registers as plugin function in any case if this plugin is loaded
        (and not only on first use!)
        """
        self._instance = AlsaWave(plugin_name='alsawave', plugin_register=True)

    def __call__(self, *args, **kwargs):
        # if not self._instance:
        #     self._instance = AlsaWave(plugin_name='alsawave', plugin_register=True)
        return self._instance


# ---------------------------------------------------------------------------
# Plugin Initializer / Finalizer
# ---------------------------------------------------------------------------

@plugin.initialize
def initialize():
    jingle = plugin.get('jingle')
    jingle.factory.register("wav", AlsaWaveBuilder())
