# Milestone 2c — Async MPD Status Listener (Future: Adopted from PR #2164)

## Status: **Future Optimization** — NOT part of initial implementation

Dieser Milestone ist eine **zukünftige Optimierung**, die erst nach der stabilen
Initial-Implementierung der MediaProvider-Architektur (Milestones 0-5) angegangen wird.

## Ziel

Das bestehende Polling-basierte MPD-Status-Update durch einen Push-basierten Mechanismus
via `mpd.asyncio.MPDClient.idle()` ersetzen. Dies reduziert CPU-Last und Status-Latenz
von der aktuellen Poll-Intervall-Abhängigkeit (0.25s) auf nahezu Echtzeit.

## Abhängigkeiten

- Milestone 2 (MPD-Adapter) muss abgeschlossen und stabil sein
- MediaProvider-Architektur muss mit synchronem `python-mpd2` funktionieren
- Dieser Milestone ersetzt den synchronen MPD-Client durch den asynchronen

## Herkunft

Dieses Feature wurde aus PR #2164 (`src/jukebox/components/player/backends/mpd/interfacing_mpd.py`)
übernommen. Das Original verwendet:
- `mpd.asyncio.MPDClient` (statt synchronem `python-mpd2.MPDClient`)
- Einen dedizierten `asyncio` Event-Loop-Thread
- `async for subsystem in self.client.idle()` als Endlos-Status-Listener
- `asyncio.run_coroutine_threadsafe()` als Brücke zwischen synchroner RPC-Schicht und asynchronem MPD-Client

## Design-Entscheidungen

1. **Nicht Teil der Initial-Implementierung** — Die MediaProvider-Architektur wird zuerst
   vollständig synchron implementiert und getestet. Der Umstieg auf async MPD erfolgt als
   separate Optimierung. Grund: `asyncio` in eine synchron ausgelegte Codebase einzuführen
   ist ein signifikanter architektonischer Eingriff, der getestet und stabilisiert werden muss.

2. **Event-Loop-Thread wie in PR #2164** — Ein dedizierter Daemon-Thread hostet den asyncio
   Event-Loop. Alle synchronen Aufrufe (von RPC, RFID-Reader, etc.) werden via
   `asyncio.run_coroutine_threadsafe()` in den Event-Loop dispatcht.

3. **Graduelle Migration** — Nicht alle MPD-Aufrufe müssen sofort asynchron sein.
   Der Status-Listener (`idle()`) ist der primäre Kandidat. Playback-Kommandos
   (`play()`, `stop()`, `next()`) können zunächst synchron bleiben.

4. **Fallback auf Polling** — Der async Listener sollte so implementiert werden, dass ein
   Fallback auf Polling möglich ist (z.B. wenn die async MPD-Bibliothek nicht verfügbar ist
   oder Verbindungsprobleme auftreten).

## Konzept

```
┌─────────────────────────────────────────────────────────────────┐
│  Synchronous World (RPC, RFID, Timer)                           │
│                                                                 │
│  player.ctrl.play() ─────┐                                      │
│  player.provider.status()┤                                      │
│  timer.status_poll() ────┘                                      │
│        │                                                        │
│        │ asyncio.run_coroutine_threadsafe(async_func, loop)     │
│        ▼                                                        │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  Async Event Loop Thread (Daemon)                        │   │
│  │                                                          │   │
│  │  async def _status_listener():                           │   │
│  │      async for subsystem in client.idle():               │   │
│  │          status = await client.status()                  │   │
│  │          publishing.get_publisher().send('playerstatus', │   │
│  │                                          status)         │   │
│  │                                                          │   │
│  │  async def _handle_play():                               │   │
│  │      await client.play()                                 │   │
│  │                                                          │   │
│  │  MPDClient (async) ←→ MPD Server (:6600)                │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

## Scope

### Neue Datei: `src/jukebox/jukebox/mpd_async.py`

```python
"""
Async MPD Client Wrapper

Provides an asyncio-based MPD client with push-based status listener.
Drop-in optimization for the synchronous python-mpd2 client.

Adopted from PR #2164 with adaptations for Core architecture.

Usage:
    loop = asyncio.new_event_loop()
    t = threading.Thread(target=loop.run_forever, daemon=True)
    t.start()

    mpd = AsyncMpdClient(loop, host='localhost', port=6600)
    mpd.connect()
    mpd.start_status_listener()

    # From synchronous code:
    status = mpd.run_async(mpd.client.status())
"""

import asyncio
import logging
import threading
from typing import Optional

from mpd.asyncio import MPDClient

from jukebox import publishing

logger = logging.getLogger('jb.mpd.async')


class AsyncMpdClient:
    """
    Wrapper around mpd.asyncio.MPDClient providing:

    - Connection management
    - Push-based status listener (via MPD idle protocol)
    - Synchronous bridge (run_async) for calling async methods from sync code
    """

    def __init__(self, event_loop: asyncio.AbstractEventLoop,
                 host: str = 'localhost', port: int = 6600):
        self.client = MPDClient()
        self.loop = event_loop
        self.host = host
        self.port = port
        self._status_listener_task: Optional[asyncio.Task] = None

    # -----------------------------------------------------------
    # Connection
    # -----------------------------------------------------------

    async def _connect(self):
        return await self.client.connect(self.host, self.port)

    def connect(self):
        """
        Connect to the MPD server.

        :raises mpd.base.ConnectionError: if connection fails
        """
        result = asyncio.run_coroutine_threadsafe(
            self._connect(), self.loop
        ).result()
        logger.debug(
            f"Connected to MPD version {self.client.mpd_version} "
            f"@ {self.host}:{self.port}"
        )
        return result

    # -----------------------------------------------------------
    # Status Listener (primary motivation for async)
    # -----------------------------------------------------------

    async def _status_listener(self):
        """
        Endless status listener using MPD's idle protocol.

        Reacts to changes in any MPD subsystem (player, mixer, playlist,
        options, ...) and publishes the new status via ZeroMQ.
        """
        logger.debug("MPD Async Status Listener started")
        async for subsystem in self.client.idle():
            logger.debug(f"MPD idle change in subsystem: {subsystem}")
            try:
                status = await self.client.status()
                publishing.get_publisher().send('playerstatus', status)
            except Exception as e:
                logger.error(f"Error in MPD status listener: {e}")
                # Re-raise to let the caller handle reconnection
                raise

    def start_status_listener(self):
        """Start the push-based status listener in the event loop."""
        if self._status_listener_task is not None:
            logger.warning("Status listener already running")
            return
        self._status_listener_task = asyncio.run_coroutine_threadsafe(
            self._status_listener(), self.loop
        )

    def stop_status_listener(self):
        """Stop the push-based status listener."""
        if self._status_listener_task is not None:
            self._status_listener_task.cancel()
            self._status_listener_task = None

    # -----------------------------------------------------------
    # Synchronous Bridge
    # -----------------------------------------------------------

    async def _run_cmd_async(self, afunc, *args, **kwargs):
        """Execute an async MPD client method and await its result."""
        return await afunc(*args, **kwargs)

    def run_async(self, afunc, *args, **kwargs):
        """
        Execute an async MPD client method from synchronous code.

        Usage:
            status = mpd.run_async(mpd.client.status())
            mpd.run_async(mpd.client.play)

        :param afunc: Async callable (coroutine function)
        :return: The result of the async call
        """
        logger.debug(
            f"Executing async command {afunc.__name__} "
            f"with params {args} {kwargs}"
        )
        return asyncio.run_coroutine_threadsafe(
            self._run_cmd_async(afunc, *args, **kwargs), self.loop
        ).result()

    # -----------------------------------------------------------
    # Convenience Methods
    # -----------------------------------------------------------

    def status(self) -> dict:
        """Get current MPD status (synchronous wrapper)."""
        return self.run_async(self.client.status)

    def play(self, idx: Optional[int] = None):
        """Start or resume playback."""
        if idx is None:
            return self.run_async(self.client.play)
        else:
            return self.run_async(self.client.play, idx)

    def pause(self, state: int = 1):
        """Pause (state=1) or resume (state=0) playback."""
        return self.run_async(self.client.pause, state)

    def stop(self):
        """Stop playback."""
        return self.run_async(self.client.stop)

    def next(self):
        """Skip to next track."""
        return self.run_async(self.client.next)

    def prev(self):
        """Skip to previous track."""
        return self.run_async(self.client.previous)

    def clear(self):
        """Clear the current playlist."""
        return self.run_async(self.client.clear)

    def add(self, uri: str):
        """Add a track to the playlist."""
        return self.run_async(self.client.add, uri)

    def addid(self, uri: str):
        """Add a track to the playlist and return its ID."""
        return self.run_async(self.client.addid, uri)

    def playlistinfo(self) -> list:
        """Get the current playlist."""
        return self.run_async(self.client.playlistinfo)

    def update(self, path: str = ''):
        """Update the MPD music database."""
        return self.run_async(self.client.update, path)

    def list(self, *args):
        """List metadata from the MPD database."""
        return self.run_async(self.client.list, *args)

    def find(self, *args):
        """Find songs in the MPD database."""
        return self.run_async(self.client.find, *args)

    def lsinfo(self, path: str):
        """List contents of a directory in the music library."""
        return self.run_async(self.client.lsinfo, path)


# ---------------------------------------------------------------
# Event Loop Management
# ---------------------------------------------------------------

def start_mpd_event_loop() -> asyncio.AbstractEventLoop:
    """
    Create and start a background asyncio event loop for MPD.

    :return: The running event loop
    """
    loop = asyncio.new_event_loop()
    t = threading.Thread(
        target=loop.run_forever,
        daemon=True,
        name='MPD-AsyncEventLoop'
    )
    t.start()
    return loop
```

### Geändert: `src/jukebox/components/playermpd/__init__.py`

In der `@plugs.initialize`-Funktion wird optional der async MPD-Client initialisiert,
wenn in der Konfiguration aktiviert:

```python
@plugs.initialize
def initialize():
    global player_ctrl
    # ... bestehende synchron-Initialisierung ...

    # ==== NEU: Optional async MPD client ====
    use_async_mpd = cfg.setndefault('playermpd', 'async_idle', value=False)
    if use_async_mpd:
        from jukebox.mpd_async import AsyncMpdClient, start_mpd_event_loop
        loop = start_mpd_event_loop()
        mpd_async = AsyncMpdClient(loop)
        mpd_async.connect()
        mpd_async.start_status_listener()
        # Store for use by PlayerMPD
        player_ctrl._mpd_async = mpd_async
        logger.info("Async MPD client initialized with idle listener")
```

## Konfiguration in `jukebox.default.yaml`

```yaml
playermpd:
  # ... bestehende Konfiguration ...
  # Enable async MPD client with push-based status listener (future optimization)
  # When false (default), uses synchronous python-mpd2 with polling
  async_idle: false
```

## Wann dieser Milestone aktiviert werden sollte

1. **Nach** stabiler Initial-Implementierung aller MediaProvider-Meilensteine (M0-M5)
2. **Wenn** CPU-Last durch Polling auf ressourcenbeschränkten Geräten (Pi Zero) zum Problem wird
3. **Wenn** Status-Latenz von ~250ms nicht akzeptabel ist
4. **Wenn** die zusätzliche Code-Komplexität (Event-Loop-Thread) gerechtfertigt ist

## Tests

### Neu: `test/mpd_async/test_mpd_async.py`

- Test: `AsyncMpdClient.connect()` verbindet erfolgreich (mit Mock-MPD)
- Test: `start_status_listener()` startet idle loop
- Test: `stop_status_listener()` stoppt idle loop
- Test: `run_async()` dispatcht korrekt in Event-Loop
- Test: `run_async()` propagiert Exceptions aus async code
- Test: `status()` gibt MPD-Status zurück
- Test: Fallback von async auf sync bei Verbindungsabbruch

## Akzeptanzkriterien

- [ ] `AsyncMpdClient` kann importiert werden: `from jukebox.mpd_async import AsyncMpdClient`
- [ ] `start_mpd_event_loop()` erstellt und startet Event-Loop-Thread
- [ ] `connect()` verbindet zum MPD-Server
- [ ] `start_status_listener()` startet Push-basierte Status-Updates
- [ ] Status-Updates werden via ZeroMQ Publisher gesendet
- [ ] `run_async()` erlaubt synchrone Aufrufe von async MPD-Methoden
- [ ] Alle Convenience-Methoden (`play()`, `stop()`, `next()`, etc.) funktionieren
- [ ] Feature ist standardmäßig deaktiviert (`async_idle: false`)
- [ ] Synchroner Fallback funktioniert unverändert
- [ ] Kein Einfluss auf bestehende Tests bei deaktiviertem async Modus

## Bekannte Einschränkungen

1. **`mpd.asyncio` Verfügbarkeit:** Der async MPD-Client erfordert `python-mpd2` mit asyncio
   Unterstützung. Dies ist in aktuellen Versionen (>3.0) enthalten, muss aber auf dem
   Zielsystem verfügbar sein.

2. **Thread Safety:** Alle MPD-Interaktionen müssen über den Event-Loop-Thread laufen.
   Direkte Aufrufe des `MPDClient` von anderen Threads sind nicht erlaubt und führen zu
   undefiniertem Verhalten.

3. **Reconnection:** Bei Verbindungsabbruch muss der idle listener neu gestartet werden.
   PR #2164 behandelt diesen Fall nicht; hier muss eine Reconnection-Logik ergänzt werden.

4. **Komplexität:** Ein zusätzlicher Thread + Event-Loop erhöht die Systemkomplexität.
   Dies ist der Hauptgrund, warum dieser Milestone als "Future Optimization" klassifiziert ist.

---

*Adaptiert von PR #2164 — `components/player/backends/mpd/interfacing_mpd.py`*