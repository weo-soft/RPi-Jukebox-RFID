# Milestone 2b — Cover Art Cache Manager (Adopted from PR #2164)

## Ziel

Einen mutagen-basierten Cover-Art-Cache-Manager implementieren, der eingebettete Album-Cover
aus MP3-Dateien extrahiert und im Dateisystem cached. Dieser Milestone ist eine direkte
Adaption des `CoverartCacheManager` aus PR #2164, integriert in die MediaProvider-Architektur.

## Abhängigkeiten

- Milestone 1 (MediaProvider Interface + Manager) muss abgeschlossen sein
- `mutagen` muss in `requirements.txt` verfügbar sein (wird via Core-Installer installiert)

## Herkunft

Dieses Feature wurde aus PR #2164 (`src/jukebox/components/player/core/coverart_cache_manager.py`)
übernommen. Das Original verwendet:
- `mutagen.mp3.MP3` und `mutagen.id3.ID3` / `APIC` zur Extraktion eingebetteter Cover-Bilder
- Ein Dateisystem-Cache unter `coverart_cache_path` (konfigurierbar, Default: `../../src/webapp/build/cover-cache`)
- SHA256-basierte Cache-Keys aus dem Dateinamen-Stem
- Eine Worker-Thread-Queue für nicht-blockierende Cache-Schreibvorgänge
- Ein spezielles `no-art` Suffix für Dateien ohne Cover Art (um wiederholte erfolglose Extraktion zu vermeiden)

## Design-Entscheidungen

1. **Als Core-Utility-Modul** — `CoverartCacheManager` wird als wiederverwendbare Utility-Klasse
   in `jukebox/coverart_cache.py` (Core-Package) implementiert, nicht als Teil einer bestimmten
   Provider-Implementierung. Grund: Cover-Art-Extraktion wird von mehreren Providern benötigt
   (MPD für lokale Dateien, potenziell SMB für gemountete Dateien).

2. **Konfiguration via `jukebox.yaml`** — Der Cache-Pfad wird unter dem bestehenden `webapp:`-
   Config-Key definiert (konsistent mit PR #2164):
   ```yaml
   webapp:
     coverart_cache_path: ../../src/webapp/build/cover-cache
   ```

3. **`mutagen` als Core-Dependency** — Wird zu `requirements.txt` hinzugefügt. PR #2164
   fügt `pyyaml` hinzu (redundant, da `ruamel.yaml` bereits verfügbar). Hier wird nur das
   tatsächlich benötigte `mutagen` hinzugefügt.

4. **Cache-Pfad-Konfiguration** — Der Pfad muss über den Config-Handler gesetzt werden können,
   mit einem sinnvollen Default. Der Pfad sollte relativ zum Projekt-Root sein (wie andere
   Pfade in der Konfiguration).

## Integration in die MediaProvider-Architektur

```
jukebox/coverart_cache.py  (Core-Utility)
  │
  ├──→ MpdMediaProvider.get_single_coverart()
  │      Extrahiert Cover aus lokalen MP3-Dateien
  │
  ├──→ SmbMediaProvider.get_single_coverart()
  │      Extrahiert Cover aus MP3-Dateien auf gemounteten GVFS-Pfaden
  │
  └──→ JellyfinMediaProvider.get_single_coverart()
         NICHT verwendet — Jellyfin liefert Cover-URLs direkt von der API
```

**Wichtig:** Der `CoverartCacheManager` wird NICHT direkt in die `MediaProvider`-ABC aufgenommen.
Stattdessen erhalten die konkreten Provider-Implementierungen Zugriff auf eine shared instance
(wie der `MediaProviderManager` ein Singleton ist, so kann auch der `CoverartCacheManager` als
Singelton bereitgestellt werden).

## Dateien

### Neu: `src/jukebox/jukebox/coverart_cache.py`

Adaptiert von PR #2164 (`components/player/core/coverart_cache_manager.py`) mit folgenden
Änderungen:
- Modul-Pfad: `jukebox/coverart_cache.py` (Core, nicht Component)
- Config-Handler: `jukebox.cfghandler.get_handler('jukebox')` (wie andere Core-Module)
- Keine Abhängigkeit von `components.player.*`
- Zusätzliche Methode: `invalidate(cache_key)` zum Löschen einzelner Cache-Einträge
- Doku-Strings im ReStructuredText-Format (Projekt-Standard)

```python
"""
Cover Art Cache Manager

Extracts embedded album art from MP3 files using mutagen and caches
the results on the filesystem for fast retrieval by the WebUI.

Adopted from PR #2164 with adaptations for Core utility use.

Cache structure:
    {coverart_cache_path}/
        cover-{sha256(stem)}.jpg     ← Cached cover image
        cover-{sha256(stem)}.no-art  ← Marker: file has no embedded cover

Usage:
    from jukebox.coverart_cache import CoverartCacheManager

    manager = CoverartCacheManager()
    filename = manager.get_cache_filename("/path/to/song.mp3")
    # Returns: "cover-abc123.jpg", "CACHE_PENDING", or "" (no art)
"""

import hashlib
import logging
from pathlib import Path
from queue import Queue
from threading import Thread

from mutagen.mp3 import MP3
from mutagen.id3 import ID3, APIC

import jukebox.cfghandler

COVER_PREFIX = 'cover'
NO_COVER_ART_EXTENSION = 'no-art'
NO_CACHE = ''
CACHE_PENDING = 'CACHE_PENDING'

logger = logging.getLogger('jb.coverart')
cfg = jukebox.cfghandler.get_handler('jukebox')


class CoverartCacheManager:
    """
    Extracts and caches embedded album art from MP3 files.

    Uses mutagen to read ID3 tags and extract APIC (Attached Picture) frames.
    Results are cached on the filesystem to avoid repeated extraction.

    Cache entries:
    - ``cover-{hash}.{ext}`` — successfully extracted cover image
    - ``cover-{hash}.no-art`` — marker indicating the file has no embedded cover

    A background worker thread processes extraction requests to avoid
    blocking the main thread during initial cache population.
    """

    def __init__(self):
        coverart_cache_path = cfg.setndefault(
            'webapp', 'coverart_cache_path',
            value='../../src/webapp/build/cover-cache'
        )
        self.cache_folder_path = Path(coverart_cache_path).expanduser()
        self.cache_folder_path.mkdir(parents=True, exist_ok=True)

        self.write_queue = Queue()
        self.worker_thread = Thread(
            target=self._process_write_requests,
            daemon=True,
            name='CoverartCacheWorker'
        )
        self.worker_thread.start()

    # ---------------------------------------------------------------
    # Public API
    # ---------------------------------------------------------------

    def get_cache_filename(self, mp3_file_path: str) -> str:
        """
        Get the cache filename for an MP3 file.

        If the cover art is already cached, returns the filename.
        If no cover art exists (cached negative result), returns ``""``.
        If not yet cached, submits an extraction request and returns
        ``CACHE_PENDING``.

        :param mp3_file_path: Absolute or relative path to the MP3 file
        :return: Cache filename, empty string, or ``CACHE_PENDING``
        """
        base_filename = Path(mp3_file_path).stem
        cache_key = self._generate_cache_key(base_filename)

        for path in self.cache_folder_path.iterdir():
            if path.stem == cache_key:
                if path.suffix == f".{NO_COVER_ART_EXTENSION}":
                    return NO_CACHE
                return path.name

        # Not yet cached — submit extraction request
        self._save_to_cache(mp3_file_path)
        return CACHE_PENDING

    def flush_cache(self):
        """
        Delete all cached cover art files.

        Useful after a library rescan or when disk space is low.
        """
        count = 0
        for path in self.cache_folder_path.iterdir():
            if path.is_file():
                path.unlink()
                count += 1
        logger.info(f"Cache flushed: {count} file(s) deleted")

    def invalidate(self, mp3_file_path: str):
        """
        Remove a specific file's cached cover art.

        :param mp3_file_path: Path to the MP3 file to invalidate
        """
        base_filename = Path(mp3_file_path).stem
        cache_key = self._generate_cache_key(base_filename)

        for path in self.cache_folder_path.iterdir():
            if path.stem == cache_key:
                path.unlink()
                logger.debug(f"Invalidated cache entry: {path.name}")
                return

    # ---------------------------------------------------------------
    # Internal
    # ---------------------------------------------------------------

    def _generate_cache_key(self, base_filename: str) -> str:
        """Generate a deterministic cache key from a filename stem."""
        return f"{COVER_PREFIX}-{hashlib.sha256(base_filename.encode()).hexdigest()}"

    def _save_to_cache(self, mp3_file_path: str):
        """Submit an extraction request to the background worker queue."""
        self.write_queue.put(mp3_file_path)

    def _save_to_cache_sync(self, mp3_file_path: str) -> str:
        """
        Extract and cache cover art synchronously.

        :return: Cache filename or ``NO_CACHE`` marker extension
        """
        base_filename = Path(mp3_file_path).stem
        cache_key = self._generate_cache_key(base_filename)
        file_extension, data = self._extract_album_art(mp3_file_path)

        cache_filename = f"{cache_key}.{file_extension}"
        full_path = self.cache_folder_path / cache_filename

        with full_path.open('wb') as f:
            f.write(data)

        logger.debug(f"Cached cover art: {cache_filename}")
        return cache_filename

    def _extract_album_art(self, mp3_file_path: str) -> tuple:
        """
        Extract the first embedded image from an MP3 file's ID3 tags.

        :return: Tuple of ``(file_extension, image_data)``.
                 Returns ``(NO_COVER_ART_EXTENSION, b'')`` if no art found.
        """
        try:
            audio_file = MP3(mp3_file_path, ID3=ID3)
        except Exception as e:
            logger.error(f"Error reading MP3 file {mp3_file_path}: {e}")
            return (NO_COVER_ART_EXTENSION, b'')

        for tag in audio_file.tags.values():
            if isinstance(tag, APIC):
                mime_type = tag.mime
                file_extension = (
                    'jpg' if mime_type == 'image/jpeg'
                    else mime_type.split('/')[-1]
                )
                return (file_extension, tag.data)

        return (NO_COVER_ART_EXTENSION, b'')

    def _process_write_requests(self):
        """Background worker: processes cache write requests from the queue."""
        while True:
            mp3_file_path = self.write_queue.get()
            try:
                self._save_to_cache_sync(mp3_file_path)
            except Exception as e:
                logger.error(f"Error processing cover art request: {e}")
            finally:
                self.write_queue.task_done()


# ---------------------------------------------------------------
# Module-Singleton
# ---------------------------------------------------------------

_coverart_cache_instance: CoverartCacheManager = None


def get_coverart_cache() -> CoverartCacheManager:
    """
    Get the module-singleton CoverartCacheManager instance.

    Usage:
        from jukebox.coverart_cache import get_coverart_cache
        cache = get_coverart_cache()
        filename = cache.get_cache_filename(song_path)
    """
    global _coverart_cache_instance
    if _coverart_cache_instance is None:
        _coverart_cache_instance = CoverartCacheManager()
    return _coverart_cache_instance
```

### Geändert: `requirements.txt`

```diff
+# for cover art extraction from MP3 files
+mutagen
```

> **Hinweis:** PR #2164 fügt `pyyaml` hinzu. Dies wird **nicht** übernommen, da das Projekt
> bereits `ruamel.yaml` verwendet (welches YAML 1.2 unterstützt und ein Superset von PyYAML ist).
> Nur das tatsächlich benötigte `mutagen` wird hinzugefügt.

## Integration in Milestone 2 (MPD-Adapter)

### MpdMediaProvider

```python
# In MpdMediaProvider (src/jukebox/components/playermpd/mpd_provider.py)

from jukebox.coverart_cache import get_coverart_cache

class MpdMediaProvider(MediaProvider):
    def __init__(self):
        super().__init__()
        self._player = None
        self._coverart_cache = get_coverart_cache()

    @plugs.tag
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        """Get cover art for a single track via mutagen extraction + cache."""
        mp3_full_path = Path(
            components.player.get_music_library_path()
        ).expanduser() / song_url
        return self._coverart_cache.get_cache_filename(str(mp3_full_path))
```

### PlayerMPD Migration

Die bestehende PlayerMPD-Instanz migriert von ihrem lokalen
`components/playermpd/coverart_cache_manager.CoverartCacheManager` auf die neue
Core-Singleton-Instanz. Dadurch teilen sich `PlayerMPD` und `MpdMediaProvider`
dieselbe Cache-Instanz:

```python
# In PlayerMPD.__init__() (src/jukebox/components/playermpd/__init__.py):
#
# Alt:
#   from .coverart_cache_manager import CoverartCacheManager
#   self.coverart_cache_manager = CoverartCacheManager()
#
# Neu:
from jukebox.coverart_cache import get_coverart_cache
self.coverart_cache_manager = get_coverart_cache()
```

Das bestehende Modul `components/playermpd/coverart_cache_manager.py` wird entfernt.
Die `get_single_coverart()`, `get_album_coverart()`, und `flush_coverart_cache()`
Methoden von `PlayerMPD` bleiben unverändert — sie verwenden `self.coverart_cache_manager`
wie bisher, nur dass dieser jetzt die Core-Singleton-Instanz ist.

Diese Integration ersetzt den bisherigen dummy-Delegationsaufruf an `PlayerMPD` und
bietet echte Cover-Art-Extraktion mit Caching, **geteilt zwischen allen Providern**.

## Integration in Milestone 6 (SMB-Plugin)

In `SmbMediaProvider` kann `get_single_coverart()` ebenfalls den `CoverartCacheManager`
verwenden, da dieser mit absoluten Dateipfaden arbeitet (die GVFS-Pfade sind absolute
Pfade unter `/run/user/$UID/gvfs/`):

```python
# In SmbMediaProvider (src/jukebox/components/smb/smb_provider.py)

from jukebox.coverart_cache import get_coverart_cache

class SmbMediaProvider(MediaProvider):
    def __init__(self, mpd_backend: MediaProvider):
        super().__init__()
        self._mpd = mpd_backend
        self._coverart_cache = get_coverart_cache()
        # ...

    @plugs.tag
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        """Get cover art from an SMB-mounted file."""
        local_path = self._remote_to_local(song_url)
        if not os.path.isfile(local_path):
            return None
        return self._coverart_cache.get_cache_filename(local_path)
```

## Konfiguration in `jukebox.default.yaml`

```yaml
webapp:
  coverart_cache_path: ../../src/webapp/build/cover-cache
```

## Tests

### Neu: `test/coverart/test_coverart_cache.py`

- Test: `get_cache_filename()` mit Datei die Cover enthält → gibt Cache-Dateinamen zurück
- Test: `get_cache_filename()` mit Datei ohne Cover → gibt Leerstring zurück
- Test: `get_cache_filename()` bei erstmaligem Aufruf → gibt `CACHE_PENDING` zurück
- Test: `flush_cache()` löscht alle Cache-Dateien
- Test: `invalidate()` löscht einen spezifischen Eintrag
- Test: `_extract_album_art()` mit ungültiger Datei → `(NO_COVER_ART_EXTENSION, b'')`
- Test: `_generate_cache_key()` ist deterministisch
- Test: Cache-Thread verarbeitet Queue-Einträge

## Abhängigkeiten & Installationskontext

`mutagen` ist eine neue Core-Dependency. Der Core-Installer installiert sie automatisch
via `pip install -r requirements.txt`. Keine zusätzlichen System-Pakete erforderlich.

Für lokale Entwicklung/Testing:
```bash
pip install mutagen
```

## Akzeptanzkriterien

- [ ] `CoverartCacheManager` kann importiert werden: `from jukebox.coverart_cache import CoverartCacheManager`
- [ ] `get_coverart_cache()` gibt Singleton-Instanz zurück
- [ ] `get_cache_filename()` extrahiert Cover aus MP3-Dateien
- [ ] `get_cache_filename()` cached negative Ergebnisse (`.no-art` Dateien)
- [ ] `flush_cache()` löscht alle Cache-Einträge
- [ ] `invalidate()` löscht einen einzelnen Cache-Eintrag
- [ ] Worker-Thread verarbeitet Queue ohne Blocking
- [ ] `MpdMediaProvider.get_single_coverart()` verwendet den Cache-Manager
- [ ] `SmbMediaProvider.get_single_coverart()` verwendet den Cache-Manager
- [ ] `mutagen` ist in `requirements.txt` gelistet
- [ ] `coverart_cache_path` ist in `jukebox.default.yaml` konfigurierbar