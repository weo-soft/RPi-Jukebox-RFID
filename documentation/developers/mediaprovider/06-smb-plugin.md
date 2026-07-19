# Milestone 6 — Plugin: SMB MediaProvider

## Ziel

Einen `SmbMediaProvider` erstellen, der Musikdateien von **mehreren** SMB/CIFS-Netzwerkfreigaben bereitstellt, **ohne Root-Rechte** zu benötigen. Jede Freigabe wird mittels `gio mount` (GVFS FUSE) benutzerspace-gemountet, sodass MPD die Dateien nativ lesen kann — **kein eingebetteter HTTP-Server**, kein in-memory-buffering.

**Registration:** Der SMB-Provider wird als **ein** Plugin `smb.provider` registriert (unter dem Plugin-Package `smb`, das via `load_all_unnamed` geladen wird). Mehrere Shares werden **innerhalb des Plugins** verwaltet — ohne Änderungen an `plugs.py`, `MediaProviderManager` oder Card-Routing:

- `smb.provider.play_folder("music:/Album")`
- `smb.provider.play_folder("audiobooks:/Kapitel1")`
- `smb.provider.list_all_dirs()` — listet alle Shares als Top-Level-Verzeichnisse

**Wichtig:** `plugs.register(instance, package='smb', name='provider')` funktioniert, weil `smb` via `load_all_unnamed` als Plugin-Package geladen ist. Nicht `package='smb_provider'` verwenden — das würde `NameError` werfen.

**Wichtig:** Alle Methoden, die via RPC aufrufbar sein sollen, müssen mit `@plugs.tag` dekoriert werden (`plugs.dereference()` prüft `plugs_callable`-Attribut).

## Multi-Share-Design

### Warum Plugin-intern (nicht mehrere Plugin-Instanzen)?

`plugs.load()` verhindert explizit das mehrfache Laden desselben Python-Packages (`_PACKAGE_MAP`-Guard). Ein zweites `smb` in `modules.others` würde einen `NameError` werfen.

Die Lösung: **Ein** Plugin (`smb.provider`), das intern mehrere Shares verwaltet. Der `folder`-Parameter in `play_card()` / `play_folder()` enthält einen **Share-Namen als Präfix**, getrennt durch `:/`:

```
folder-Format:  "{share_name}:/{remote_path}"

Beispiele:
  "music:/Album"           → Share "music", Pfad "/Album"
  "audiobooks:/Kapitel1"   → Share "audiobooks", Pfad "/Kapitel1"
  "music:/"                → Share "music", Root-Verzeichnis
```

### Second-Swipe-Verhalten

Der `folder`-String ist provider-opaque (wird vom MediaProvider-Basisklassen-Code nur als String verglichen). Da `"music:/Album"` ≠ `"audiobooks:/Album"`, werden Second-Swipes **pro Share** korrekt erkannt:

- Karte A: `"music:/Album"` → first swipe, spielt Album vom Music-Share
- Karte A erneut: `"music:/Album"` → second swipe (gleicher String!)
- Karte B: `"audiobooks:/Album"` → first swipe (anderer String, obwohl gleicher Pfad)

## Abhängigkeiten

- Milestone 0 (Prerequisites — `jukebox.secrets.retrieve()`, `PlayCardState` in `jukebox.callingback`)
- Milestone 1 (MediaProvider Interface)
- Milestone 2 (MPD-Adapter) — MPD als Audio-Backend (liest Dateien direkt vom gemounteten Pfad)
- **Keine Abhängigkeit** zu Milestone 5 (Card Routing) — SMB ist ein unabhängiges Plugin

## Lösung: gio mount (GVFS FUSE)

### Warum gio mount?

```
SMB Shares:
  //server/music      ──→ gio mount ──→ /run/user/$UID/gvfs/smb-share:server=...,share=music
  //server/audiobooks ──→ gio mount ──→ /run/user/$UID/gvfs/smb-share:server=...,share=audiobooks
    │
    ▼
MPD liest Dateien nativ vom Dateisystempfad
    • Kein HTTP-Server im Jukebox-Prozess
    • Kein in-memory-buffering
    • MPD kann alle Formate nativ abspielen
    • Cover Art funktioniert (MPD greift auf Dateien zu)
    • `mpc update` aktualisiert die Library
```

### Vorteile gegenüber pysmb + HTTP-Server

| Aspekt | pysmb + HTTP (alt) | gio mount (neu) |
|---|---|---|
| Root-Rechte | Nein | Nein (FUSE) |
| MPD-Integration | HTTP-Stream | Native Dateizugriffe |
| Cover Art | Nicht unterstützt | Ja (MPD liest embedded Cover) |
| Audio-Formate | Nur HTTP-streaming | Alle MPD-Formate |
| Performance | Komplette Datei im RAM | MPD liest chunks |
| Abhängigkeiten | pysmb + http.server | GVFS (GIO/GLib) |
| Komplexität | HTTP-Server, threading | Einfacher Mount + Pfad |
| Multi-Share | Mehrere HTTP-Server | Mehrere `gio mount`-Aufrufe |

### Einschränkungen

- `gio mount` erfordert eine laufende D-Bus Session (auf Raspberry Pi OS standardmäßig vorhanden; **Hinweis:** beim Headless-Betrieb via `systemctl --user` ist D-Bus verfügbar)
- Die gemounteten Pfade liegen unter `/run/user/$UID/gvfs/` und sind nur für den Benutzer sichtbar
- Bei SMB-Server-Neustart: Verbindung geht verloren, `@atexit` dismountet alle Shares sauber
- GVFS/GIO muss installiert sein (als externe System-Abhängigkeit des Plugins; bei fehlender Installation wird ein aussagekräftiger Fehler geloggt)

### gio-Verfügbarkeitsprüfung

Das Plugin prüft vor dem Mount-Versuch, ob das `gio`-Kommando verfügbar ist:

```python
import shutil
if not shutil.which('gio'):
    raise RuntimeError(
        "gio command not found. GVFS/GIO is required for SMB mounting. "
        "Install with: sudo apt-get install gvfs gvfs-fuse"
    )
```

## Secrets-Handling für SMB-Credentials

**Wichtig:** Das Passwort darf NICHT als Teil der Kommandozeile an `gio mount` übergeben werden, da es sonst im Process-Listing (`ps aux`) für alle Benutzer sichtbar wäre.

Stattdessen:
1. **Username/Passwort aus Environment-Variablen** lesen (`SMB_USERNAME`, `SMB_PASSWORD`)
2. **`gio mount` URL OHNE Passwort** bauen: `smb://user@server/share` (nicht `smb://user:pass@server/share`)
3. **Passwort per stdin** an den Mount-Prozess übergeben

**Multi-Share-Credentials:** Alle Shares in `smb.shares` teilen sich denselben Username/Passwort (gelesen via `retrieve() aus `jukebox.secrets``). Falls in Zukunft unterschiedliche Credentials pro Share benötigt werden, können `username`/`password` optional pro Share-Eintrag überschrieben werden.

Siehe [Secrets Handling](00a-secrets-infrastructure.md) für das Gesamtkonzept.

## Scope

- Neues Package `src/jukebox/components/smb/`
- `SmbMediaProvider` implementiert `MediaProvider`
- `gio mount` für **mehrere** SMB-Verbindungen (kein `mount.cifs`, kein pysmb)
- MPD-Bibliothek-Update nach erfolgreichem Mount
- **Kein** eingebetteter HTTP-Server
- Alle RPC-Methoden mit `@plugs.tag` dekoriert
- **`install_dependencies.sh`** — mitgeliefertes Shell-Skript, das die System-Abhängigkeiten (gvfs, gvfs-fuse, gvfs-backends) installiert
- **`configure.sh`** — interaktives Post-Install-Skript zur Konfiguration mehrerer Shares

## Mitgeliefertes Installationsskript: `install_dependencies.sh`

GVFS/GIO ist eine System-Abhängigkeit (apt-Pakete, nicht pip-installierbar). Das Plugin liefert ein Shell-Skript mit, das der Builder beim Plugin-Setup ausführt. Das Skript:

1. Prüft, ob `gio` bereits verfügbar ist (→ `command -v gio`)
2. Falls nicht: installiert `gvfs gvfs-fuse gvfs-backends` via `apt-get`
3. Stellt sicher, dass das FUSE-Kernelmodul geladen ist

Zusätzlich zur Prüfung in `SmbMediaProvider.initialize()` (die als Safety-Guard läuft und eine klare Fehlermeldung liefert, falls das Skript vergessen wurde), **installiert** dieses Skript die Abhängigkeiten aktiv. Das Skript wird Teil des Plugin-Repositories und vom Builder beim Setup ausgeführt:

```bash
# Vom Builder auszuführen:
bash src/jukebox/components/smb/install_dependencies.sh
```

## Konzept

```
┌──────────────────────────────────────────────────────────────────┐
│                    SMBMediaProvider                               │
│                                                                  │
│  @initialize:                                                    │
│    1. Config-Validierung (smb.shares muss gesetzt sein)         │
│    2. Prüfe: gio-Kommando verfügbar                              │
│    3. Lese globale Credentials via retrieve() aus `jukebox.secrets`                   │
│    4. Für JEDEN Share in smb.shares:                             │
│       a. gio mount smb://user@server/share (OHNE Passwort!)     │
│       b. Passwort per stdin übergeben                           │
│       c. Warte auf Mount unter /run/user/$UID/gvfs/...          │
│       d. Speichere share_name → mount_point Mapping              │
│    5. Registriere Provider im MediaProviderManager               │
│    6. Registriere als RPC unter smb.provider                     │
│                                                                  │
│  play_card("music:/Album"):                                      │
│    → GEERBT VON BASISKLASSE (MediaProvider.play_card())          │
│      → Globales _last_played_folder Check (Manager)             │
│      → Bei first swipe: play_folder("music:/Album")             │
│                                                                  │
│  play_folder("music:/Album"):                                    │
│    1. Parse share_name="music", remote_path="/Album"            │
│    2. Übersetze remote_path → lokalen GVFS-Pfad des Shares      │
│    3. Rufe MPDs play_folder() mit lokalem Pfad auf               │
│                                                                  │
│  list_all_dirs():                                                │
│    → Listet alle Share-Namen als Top-Level-"Verzeichnisse"       │
│                                                                  │
│  @atexit:                                                        │
│    1. Für jeden Share: gio mount -u smb://server/share           │
└──────────────────────────────────────────────────────────────────┘
```

## Config — Multi-Share-Struktur

```yaml
# jukebox.yaml
smb:
  # Globale Credentials (für alle Shares, via retrieve() aus `jukebox.secrets`:
  #   SMB_USERNAME (env) > smb.username (yaml) → default: 'guest'
  #   SMB_PASSWORD (env) > smb.password (yaml) → default: ''
  username: guest
  password: ""

  # Mehrere Shares (mindestens einer erforderlich)
  shares:
    music:
      server: "192.168.1.100"
      share: "music"
      # username/password können pro Share überschrieben werden (optional)
    audiobooks:
      server: "192.168.1.100"
      share: "audiobooks"
    nas_media:
      server: "10.0.0.50"
      share: "Media"
      username: "nasuser"     # ← Share-spezifischer Username (optional)
      password: "naspass"     # ← Share-spezifisches Passwort (optional)
```

**Regeln:**
- `smb.shares` ist ein dict mit **mindestens einem** Eintrag
- Jeder Share-Key (z.B. `music`, `audiobooks`) wird als Share-Name im `folder`-Format verwendet
- `server` und `share` sind pro Eintrag **pflicht**
- `username`/`password` pro Share sind **optional** — Fallback auf globale `smb.username`/`smb.password`, dann auf `retrieve() aus `jukebox.secrets``-Defaults
- Credentials werden via `retrieve() aus `jukebox.secrets`` aus `SMB_USERNAME`/`SMB_PASSWORD` Environment-Variablen gelesen
- Die alte Single-Share-Konfiguration (`smb.server`/`smb.share`) wird **nicht** unterstützt (Breaking Change zum initialen Entwurf)

## Config-Validierung

Bei unvollständiger Konfiguration wird eine aussagekräftige Fehlermeldung geworfen:

```python
shares = cfg.getn('smb', 'shares', default=None)
if not shares:
    raise ValueError(
        "SMB configuration incomplete: 'smb.shares' is not set. "
        "Add to jukebox.yaml:\n"
        "  smb:\n"
        "    shares:\n"
        "      music:\n"
        "        server: 192.168.1.100\n"
        "        share: music"
    )

errors = []
for share_name, share_cfg in shares.items():
    if not share_cfg.get('server'):
        errors.append(f"'smb.shares.{share_name}.server' is not set")
    if not share_cfg.get('share'):
        errors.append(f"'smb.shares.{share_name}.share' is not set")
if errors:
    raise ValueError("SMB configuration incomplete:\n  " + "\n  ".join(errors))
```

## Dateien

### Neu: `src/jukebox/components/smb/__init__.py`

```python
"""
SMB Media Provider Plugin

Stellt Musik von mehreren SMB/CIFS-Netzwerkfreigaben bereit, **ohne Root-Rechte**.

Second-Swipe-Logik: Wird von der Basisklasse MediaProvider.play_card() geerbt.
    SmbMediaProvider überschreibt play_card() NICHT.
    Die globale second_swipe_action kommt aus playermpd.second_swipe_action (vom Manager).
    play_card_callbacks werden zentral über den Manager gefeuert.

Multi-Share:
  - Ein Plugin (smb.provider) verwaltet mehrere Shares intern
  - Das folder-Format ist "sharename:/pfad" (z.B. "music:/Album")
  - list_all_dirs() zeigt alle Share-Namen als Top-Level-Verzeichnisse
  - Keine Änderungen an plugs.py, MediaProviderManager oder Card-Routing nötig

Funktionsweise:
  - gio mount (GVFS) mountet jede Freigabe benutzerspace
  - MPD liest die Dateien nativ vom gemounteten Pfad
  - Kein eingebetteter HTTP-Server, kein pysmb

Secrets-Handling:
  - Username/Passwort werden via retrieve() aus `jukebox.secrets` aus Environment-Variablen geladen
  - Passwort erscheint NICHT in CLI-Argumenten (kein ps aux leak)
  - Globale Credentials (smb.username/smb.password), pro Share überschreibbar
  - Siehe documentation/develope00a-secrets-infrastructure.md
"""

import os
import logging
import subprocess
import time
import pathlib
import shutil
import jukebox.plugs as plugs
import jukebox.cfghandler
from typing import Optional, Dict

logger = logging.getLogger('jb.smb')
cfg = jukebox.cfghandler.get_handler('jukebox')

smb_provider_instance = None


def _find_gvfs_mount(server: str, share: str, timeout: float = 10.0) -> Optional[str]:
    """
    Warte auf das Auftauchen des GVFS-Mounts.

    gio mount mountet nach /run/user/$UID/gvfs/...
    Der genaue Pfad ist dynamisch (enthält Server und Share-Name).

    :param server: SMB-Server (IP oder Hostname)
    :param share: SMB-Share-Name
    :param timeout: Maximale Wartezeit in Sekunden
    :return: Lokaler GVFS-Pfad oder None bei Timeout
    """
    gvfs_base = pathlib.Path(f"/run/user/{os.getuid()}/gvfs")

    start = time.time()
    while time.time() - start < timeout:
        if gvfs_base.exists():
            for entry in gvfs_base.iterdir():
                name = entry.name.lower()
                if server.lower().replace('.', '-') in name and share.lower() in name:
                    return str(entry)
        time.sleep(0.5)

    logger.error(f"GVFS mount for {server}/{share} not found after {timeout}s")
    return None


@plugs.initialize
def initialize():
    """Initialize SMB provider — mount all configured shares"""
    global smb_provider_instance

    # Prüfen, ob MPD als Audio-Backend verfügbar ist
    from jukebox.mediaprovider import get_manager
    try:
        mpd_provider = get_manager().get_provider('mpd')
    except KeyError:
        logger.error("MPD provider not found. SMB requires MPD as audio backend.")
        return

    # Prüfen, ob gio verfügbar ist
    if not shutil.which('gio'):
        logger.error(
            "gio command not found. GVFS/GIO is required for SMB mounting. "
            "Install with: sudo apt-get install gvfs gvfs-fuse"
        )
        return

    # Config-Validierung
    shares = cfg.getn('smb', 'shares', default=None)
    if not shares:
        logger.error("SMB configuration incomplete: 'smb.shares' is not set. "
                     "Add to jukebox.yaml:\n"
                     "  smb:\n"
                     "    shares:\n"
                     "      music:\n"
                     "        server: 192.168.1.100\n"
                     "        share: music")
        return

    errors = []
    for share_name, share_cfg in shares.items():
        if not share_cfg.get('server'):
            errors.append(f"'smb.shares.{share_name}.server' is not set")
        if not share_cfg.get('share'):
            errors.append(f"'smb.shares.{share_name}.share' is not set")
    if errors:
        logger.error("SMB configuration incomplete:\n  " + "\n  ".join(errors))
        return

    from .smb_provider import SmbMediaProvider

    smb_provider_instance = SmbMediaProvider(mpd_backend=mpd_provider)
    smb_provider_instance.initialize()

    get_manager().register_provider('smb', smb_provider_instance)

    # SMB-Provider unter dem 'smb'-Package registrieren
    plugs.register(smb_provider_instance, package='smb', name='provider')

    logger.info("SMB Media Provider initialized and registered")


@plugs.atexit
def atexit(**kwargs):
    """Shutdown SMB provider gracefully — unmount all SMB shares."""
    global smb_provider_instance
    if smb_provider_instance is not None:
        smb_provider_instance.shutdown()
        smb_provider_instance = None
```

### Neu: `src/jukebox/components/smb/smb_provider.py`

```python
"""
SMB MediaProvider — stellt Musik von mehreren SMB-Freigaben ohne Root-Rechte bereit.

Second-Swipe: Wird von der Basisklasse geerbt (MediaProvider.play_card()).
    SmbMediaProvider überschreibt play_card() NICHT.

Multi-Share:
    Das folder-Format ist "sharename:/pfad" (z.B. "music:/Album").
    Der sharename identifiziert den Eintrag in smb.shares.
    list_all_dirs() zeigt alle Share-Namen als Top-Level-Verzeichnisse.

Verwendet:
  - gio mount (GVFS FUSE) für benutzerspace-Mount
  - MPD als Audio-Playback-Backend (liest Dateien nativ)
  - Kein eingebetteter HTTP-Server
  - Kein pysmb

Secrets-Handling:
  - Credentials via retrieve() (Environment > secrets.yaml > YAML)
  - Passwort NIE in CLI-Argumenten (kein ps aux leak)
  - Passwort wird per stdin an gio mount übergeben
  - Globale Credentials (smb.username/smb.password), pro Share überschreibbar

IMPORTANT: All RPC-callable methods are decorated with @plugs.tag.
"""

import os
import logging
import subprocess
import shutil
from typing import Optional, Dict

import jukebox.cfghandler
import jukebox.plugs as plugs
from jukebox.mediaprovider import MediaProvider
from jukebox.secrets import retrieve

logger = logging.getLogger('jb.smb.provider')
cfg = jukebox.cfghandler.get_handler('jukebox')

# Audio-Datei-Endungen für Filterung
AUDIO_EXTENSIONS = {'.mp3', '.flac', '.ogg', '.wav',
                    '.m4a', '.wma', '.aac', '.opus'}

# Separator zwischen Share-Name und Pfad im folder-Parameter
SHARE_PATH_SEPARATOR = ":/"


class SmbMediaProvider(MediaProvider):
    """
    MediaProvider for multiple SMB/CIFS network shares using gio mount (GVFS).

    Inherits play_card() from MediaProvider base class for second-swipe logic.
    MPD reads files natively from the mount path.

    Multi-Share:
        Config: smb.shares = {share_name: {server, share, username?, password?}}
        Folder format: "share_name:/remote/path" (e.g., "music:/Album")
        All shares share the same smb.provider RPC namespace.
    """

    def __init__(self, mpd_backend: MediaProvider):
        """
        :param mpd_backend: MPD provider as audio playback backend
        """
        super().__init__()
        self._mpd = mpd_backend
        # share_name → mount_point mapping
        self._mount_points: Dict[str, str] = {}
        # share_name → {server, share, username, password} config
        self._share_configs: Dict[str, dict] = {}
        # Globale Credentials
        self._global_username: str = 'guest'
        self._global_password: str = ''

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def initialize(self):
        """
        Mount all configured SMB shares via gio.

        Reads from jukebox.yaml:
            smb.username, smb.password  (globale Credentials, optional)
            smb.shares:                 (dict von Share-Konfigurationen)
                {share_name}:
                    server: ...         (pflicht)
                    share: ...          (pflicht)
                    username: ...       (optional, überschreibt global)
                    password: ...       (optional, überschreibt global)

        Reads credentials via retrieve() (Environment > secrets.yaml > YAML):
            SMB_USERNAME (env) > smb.username (yaml) → default: 'guest'
            SMB_PASSWORD (env) > smb.password (yaml) → default: ''

        IMPORTANT: Passwords are NEVER passed as CLI arguments.
        They are passed via stdin to gio mount, preventing disclosure
        in process listings (ps aux).

        See documentation/develope00a-secrets-infrastructure.md
        """
        # Globale Credentials
        self._global_username = retrieve('smb', 'username', env_var='SMB_USERNAME',
                                         default='guest')
        self._global_password = retrieve('smb', 'password', env_var='SMB_PASSWORD',
                                         default='')

        shares = cfg.getn('smb', 'shares', default={})
        if not shares:
            raise ValueError("SMB configuration incomplete: 'smb.shares' is not set")

        # Prüfe gio-Verfügbarkeit
        if not shutil.which('gio'):
            raise RuntimeError(
                "gio command not found. GVFS/GIO is required for SMB mounting. "
                "Install with: sudo apt-get install gvfs gvfs-fuse"
            )

        # Validiere und mounte jeden Share
        errors = []
        for share_name, share_cfg in shares.items():
            server = share_cfg.get('server')
            share = share_cfg.get('share')
            if not server:
                errors.append(f"'smb.shares.{share_name}.server' is not set")
            if not share:
                errors.append(f"'smb.shares.{share_name}.share' is not set")
        if errors:
            raise ValueError("SMB configuration incomplete:\n  " +
                             "\n  ".join(errors))

        for share_name, share_cfg in shares.items():
            server = share_cfg['server']
            share = share_cfg['share']

            # Share-spezifische Credentials (fallen zurück auf globale)
            username = share_cfg.get('username', self._global_username)
            password = share_cfg.get('password', self._global_password)

            self._share_configs[share_name] = {
                'server': server,
                'share': share,
                'username': username,
                'password': password,
            }

            # gio mount URL bauen — OHNE Passwort in der URL!
            if username == 'guest':
                mount_url = f"smb://{server}/{share}"
            else:
                mount_url = f"smb://{username}@{server}/{share}"

            logger.info(f"Mounting SMB share '{share_name}': "
                        f"smb://{username}@{server}/{share}")

            try:
                # Passwort per stdin übergeben (nicht in CLI-Argumenten sichtbar)
                stdin_input = None
                if password:
                    stdin_input = f"{username}\n\n{password}\n"

                result = subprocess.run(
                    ['gio', 'mount', mount_url],
                    input=stdin_input,
                    capture_output=True,
                    text=True,
                    timeout=30
                )
                if result.returncode != 0:
                    raise RuntimeError(
                        f"gio mount failed for share '{share_name}': "
                        f"{result.stderr.strip()}"
                    )
            except FileNotFoundError:
                raise RuntimeError(
                    "gio command not found. Is glib/GVFS installed?"
                )
            except subprocess.TimeoutExpired:
                raise RuntimeError(
                    f"gio mount timed out after 30s for share '{share_name}'"
                )

            # Auf Mount-Pfad warten
            from . import _find_gvfs_mount
            mount_point = _find_gvfs_mount(server, share)
            if mount_point is None:
                raise RuntimeError(
                    f"Could not find GVFS mount for share '{share_name}' "
                    f"({server}/{share})"
                )

            self._mount_points[share_name] = mount_point
            logger.info(f"Share '{share_name}' mounted at: {mount_point}")

        logger.info(f"SMBMediaProvider initialized with {len(self._mount_points)} "
                    f"share(s): {list(self._mount_points.keys())}")

    def shutdown(self):
        """Unmount all SMB shares."""
        for share_name, share_cfg in self._share_configs.items():
            mount_url = f"smb://{share_cfg['server']}/{share_cfg['share']}"
            try:
                subprocess.run(
                    ['gio', 'mount', '-u', mount_url],
                    capture_output=True,
                    timeout=10
                )
                logger.info(f"SMB share unmounted: '{share_name}' ({mount_url})")
            except Exception as e:
                logger.warning(
                    f"Could not unmount SMB share '{share_name}': {e}"
                )
        self._mount_points.clear()
        self._share_configs.clear()

    # ------------------------------------------------------------------
    # Pfad-Konvertierung
    # ------------------------------------------------------------------

    def _parse_folder(self, folder: str) -> tuple[str, str]:
        """
        Parse the folder parameter into (share_name, remote_path).

        Format: "share_name:/remote/path"
        - share_name: Key in smb.shares config dict
        - remote_path: Pfad innerhalb der Freigabe (z.B. "/Album")

        :raises ValueError: If the folder format is invalid or share unknown
        """
        if SHARE_PATH_SEPARATOR not in folder:
            raise ValueError(
                f"Invalid SMB folder format: '{folder}'. "
                f"Expected 'share_name{SHARE_PATH_SEPARATOR}path', "
                f"e.g. 'music{SHARE_PATH_SEPARATOR}/Album'. "
                f"Available shares: {list(self._share_configs.keys())}"
            )

        share_name, remote_path = folder.split(SHARE_PATH_SEPARATOR, 1)

        if share_name not in self._mount_points:
            raise ValueError(
                f"Unknown SMB share: '{share_name}'. "
                f"Available shares: {list(self._mount_points.keys())}"
            )

        return share_name, remote_path

    def _remote_to_local(self, folder: str) -> str:
        """
        Convert a "share_name:/remote/path" reference to the local GVFS path.

        :param folder: Full folder reference (e.g., "music:/Album")
        :return: Absolute local filesystem path
        """
        share_name, remote_path = self._parse_folder(folder)
        mount_point = self._mount_points[share_name]
        clean_path = remote_path.lstrip('/')
        return os.path.join(mount_point, clean_path)

    # ------------------------------------------------------------------
    # Playback
    # ------------------------------------------------------------------

    @plugs.tag
    def play_folder(self, folder: str, recursive: bool = False):
        """
        Play a folder from an SMB share.

        Called by the inherited base class play_card() on first swipe.

        :param folder: "share_name:/remote/path" (e.g., "music:/Album")

        Uses MPD's native absolute path handling (addid() accepts absolute paths).
        Bypasses PlaylistCollector because SMB GVFS paths are absolute
        (outside the configured music library). Uses the new clear_playlist()
        and add_to_playlist() ABC methods to build the playlist incrementally.
        """
        local_path = self._remote_to_local(folder)
        if not os.path.isdir(local_path):
            share_name, _ = self._parse_folder(folder)
            logger.error(
                f"SMB folder not found on share '{share_name}': "
                f"'{folder}' -> '{local_path}'"
            )
            return

        # Collect audio files from the GVFS-mounted directory
        audio_files = []
        if recursive:
            for root, _, files in os.walk(local_path):
                for f in files:
                    if os.path.splitext(f)[1].lower() in AUDIO_EXTENSIONS:
                        audio_files.append(os.path.join(root, f))
        else:
            for entry in sorted(os.listdir(local_path)):
                full_path = os.path.join(local_path, entry)
                if os.path.isfile(full_path) and \
                   os.path.splitext(entry)[1].lower() in AUDIO_EXTENSIONS:
                    audio_files.append(full_path)

        if not audio_files:
            logger.warning(f"No audio files found in SMB folder: {folder}")
            return

        # Build playlist using absolute GVFS paths
        # MPD's addid() handles absolute file paths natively
        self._mpd.stop()
        self._mpd.clear_playlist()
        for audio_path in audio_files:
            self._mpd.add_to_playlist(audio_path)
        self._mpd.play()
        logger.info(f"Playing {len(audio_files)} tracks from {folder}")

    @plugs.tag
    def play_single(self, song_url: str):
        """Play a single file from an SMB share."""
        local_path = self._remote_to_local(song_url)
        if not os.path.isfile(local_path):
            logger.error(f"SMB file not found: '{song_url}' -> '{local_path}'")
            return
        self._mpd.play_single(local_path)

    @plugs.tag
    def play_album(self, albumartist: str, album: str):
        """Play an album by searching across all SMB shares."""
        all_items = self.list_all_dirs()
        for item in all_items:
            if album.lower() in item['name'].lower():
                self.play_folder(item['path'])
                return
        logger.warning(f"Could not find album '{album}' on any SMB share")

    # ------------------------------------------------------------------
    # Library browsing (Multi-Share)
    # ------------------------------------------------------------------

    @plugs.tag
    def list_all_dirs(self) -> list:
        """
        List all shares as top-level directories.

        Each share is returned as a pseudo-directory.
        The 'path' uses the "share_name:/" format for use with
        play_folder() and get_folder_content().

        :return: List of {'name': share_name, 'path': 'share_name:/',
                          'type': 'directory'}
        """
        if not self._mount_points:
            return []
        return [
            {
                'name': share_name,
                'path': f"{share_name}{SHARE_PATH_SEPARATOR}",
                'type': 'directory',
            }
            for share_name in sorted(self._mount_points.keys())
        ]

    @plugs.tag
    def get_folder_content(self, folder: str) -> list:
        """
        List files and subdirectories in a remote SMB path.

        Supports two cases:
        1. folder == "share_name:/"  →  list root of that share
        2. folder == "share_name:/sub/path"  →  list that sub-path
        """
        if folder.endswith(SHARE_PATH_SEPARATOR) or folder.endswith(':/'):
            # Top-level eines Shares
            share_name = folder.rstrip(':/').rstrip(SHARE_PATH_SEPARATOR)
            if share_name not in self._mount_points:
                logger.error(f"Unknown SMB share: '{share_name}'")
                return []
            local_path = self._mount_points[share_name]
            remote_prefix = f"{share_name}{SHARE_PATH_SEPARATOR}"
        else:
            local_path = self._remote_to_local(folder)
            remote_prefix = folder

        try:
            entries = os.listdir(local_path)
            items = []
            for entry in sorted(entries):
                full_path = os.path.join(local_path, entry)
                is_dir = os.path.isdir(full_path)
                rel_path = f"{remote_prefix}/{entry}" if not remote_prefix.endswith('/') else f"{remote_prefix}{entry}"
                items.append({
                    'name': entry,
                    'type': 'directory' if is_dir else 'file',
                    'path': rel_path,
                    'size': os.path.getsize(full_path) if not is_dir else 0,
                })
            return items
        except OSError as e:
            logger.error(f"Error listing SMB folder '{folder}': {e}")
            return []

    @plugs.tag
    def list_albums(self) -> list:
        """
        List subdirectories across all shares as album approximations.

        Returns items with share-qualified paths for use with play_folder().
        """
        albums = []
        for share_name in sorted(self._mount_points.keys()):
            mount_point = self._mount_points[share_name]
            try:
                entries = os.listdir(mount_point)
            except OSError as e:
                logger.error(f"Error listing share '{share_name}': {e}")
                continue
            for entry in sorted(entries):
                full_path = os.path.join(mount_point, entry)
                if os.path.isdir(full_path):
                    albums.append({
                        'name': entry,
                        'path': f"{share_name}{SHARE_PATH_SEPARATOR}{entry}",
                        'type': 'directory',
                        'albumartist': '',  # SMB hat keine Metadaten auf dieser Ebene
                    })
        return albums

    # ------------------------------------------------------------------
    # Cover Art (via MPD)
    # ------------------------------------------------------------------

    @plugs.tag
    def get_single_coverart(self, song_url: str) -> Optional[str]:
        local_path = self._remote_to_local(song_url)
        return self._mpd.get_single_coverart(local_path)

    @plugs.tag
    def get_album_coverart(self, albumartist: str, album: str) -> Optional[str]:
        all_items = self.list_albums()
        for item in all_items:
            if album.lower() in item['name'].lower():
                share_name, remote_path = self._parse_folder(item['path'])
                mount_point = self._mount_points[share_name]
                local_dir = os.path.join(mount_point, remote_path.lstrip('/'))
                first_file = None
                try:
                    for f in os.listdir(local_dir):
                        ext = os.path.splitext(f)[1].lower()
                        if ext in AUDIO_EXTENSIONS:
                            first_file = os.path.join(local_dir, f)
                            break
                except OSError:
                    continue
                if first_file:
                    return self._mpd.get_single_coverart(first_file)
        return None

    # ------------------------------------------------------------------
    # Status & Navigation (delegiert an MPD)
    # ------------------------------------------------------------------

    @plugs.tag
    def status(self) -> dict:
        return self._mpd.status()

    @plugs.tag
    def get_current_song(self) -> Optional[dict]:
        return self._mpd.get_current_song()

    @plugs.tag
    def playlistinfo(self) -> list:
        return self._mpd.playlistinfo()

    @plugs.tag
    def play(self):
        self._mpd.play()

    @plugs.tag
    def stop(self):
        self._mpd.stop()

    @plugs.tag
    def next(self):
        self._mpd.next()

    @plugs.tag
    def prev(self):
        self._mpd.prev()

    @plugs.tag
    def toggle(self):
        self._mpd.toggle()

    @plugs.tag
    def pause(self, state: int = 1):
        self._mpd.pause(state)

    @plugs.tag
    def seek(self, new_time: float):
        self._mpd.seek(new_time)

    @plugs.tag
    def rewind(self):
        self._mpd.rewind()

    @plugs.tag
    def clear_playlist(self):
        """Delegate to MPD backend. Required by MediaProvider ABC."""
        self._mpd.clear_playlist()

    @plugs.tag
    def add_to_playlist(self, song_url: str):
        """Delegate to MPD backend. Required by MediaProvider ABC."""
        self._mpd.add_to_playlist(song_url)

    @plugs.tag
    def update(self):
        self._mpd.update()

    @plugs.tag
    def update_wait(self):
        self._mpd.update_wait()

    @plugs.tag
    def get_player_type_and_version(self) -> str:
        return f"smb (via {self._mpd.get_player_type_and_version()})"
```

### Neu: `src/jukebox/components/smb/install_dependencies.sh`

```bash
#!/bin/bash
# SMB MediaProvider — System-Dependency Installer
# Läuft als Teil der Plugin-Installation (wird vom Builder aufgerufen)
# Installiert GVFS/GIO für SMB-Mounting ohne Root-Rechte

set -e

echo "=== SMB MediaProvider: Checking system dependencies ==="

if command -v gio &> /dev/null; then
    echo "✓ gio is already installed ($(gio --version 2>&1 | head -1))"
else
    echo "→ gio not found. Installing GVFS/GIO packages..."
    sudo apt-get update
    sudo apt-get install -y gvfs gvfs-fuse gvfs-backends
    echo "✓ GVFS/GIO installed"
fi

# Verify FUSE is available (needed for user-space mounts)
if ! lsmod | grep -q fuse; then
    echo "→ FUSE kernel module not loaded. Loading..."
    sudo modprobe fuse
fi

echo "✓ FUSE is available"

echo "=== SMB MediaProvider: Dependencies ready ==="
```

### Neu: `src/jukebox/components/smb/configure.sh`

```bash
#!/usr/bin/env bash
# configure.sh — Post-Install configuration for SMB MediaProvider
# Usage: bash configure.sh smb
#
# Interactively configures one or more SMB shares.
# Writes directly to ${SETTINGS_PATH}/jukebox.yaml under the 'smb' key.

CONFIG_KEY="${1:-smb}"
CONFIG_FILE="${SETTINGS_PATH}/jukebox.yaml"

echo "=== SMB MediaProvider Configuration ==="
echo ""
echo "This plugin can mount multiple SMB/CIFS network shares."
echo "You will be asked for each share's server, share name, and"
echo "optionally username/password."
echo ""
echo "Credentials are stored in shared/settings/secrets.conf"
echo "(NOT in jukebox.yaml) for security."
echo ""

# --- Collect shares ---
SHARES_YAML=""
SHARE_INDEX=0
while true; do
    echo "--- Share #$((SHARE_INDEX + 1)) ---"
    read -r -p "Share name (e.g. 'music', 'audiobooks', or leave empty to finish): " SHARE_NAME
    if [[ -z "$SHARE_NAME" ]]; then
        break
    fi

    read -r -p "Server IP or hostname (e.g. 192.168.1.100): " SERVER
    if [[ -z "$SERVER" ]]; then
        echo "ERROR: Server is required."
        continue
    fi

    read -r -p "Share name on server (e.g. 'music'): " SHARE
    if [[ -z "$SHARE" ]]; then
        echo "ERROR: Share name is required."
        continue
    fi

    read -r -p "Username [guest]: " USERNAME
    USERNAME="${USERNAME:-guest}"

    read -r -s -p "Password (leave empty if none): " PASSWORD
    echo ""

    SHARES_YAML="${SHARES_YAML}
        ${SHARE_NAME}:
          server: \"${SERVER}\"
          share: \"${SHARE}\""

    if [[ "$USERNAME" != "guest" ]]; then
        SHARES_YAML="${SHARES_YAML}
          username: \"${USERNAME}\""
        if [[ -n "$PASSWORD" ]]; then
            # Write password to secrets.yaml (chmod 600), NOT to jukebox.yaml
            echo "  → Storing password in secrets.yaml..."
            "$VIRTUAL_ENV/bin/python3" -c "
from ruamel.yaml import YAML
yaml = YAML()
yaml.preserve_quotes = True
with open('${SECRETS_FILE}', 'r') as f:
    data = yaml.load(f) or {}
if '${CONFIG_KEY}' not in data:
    data['${CONFIG_KEY}'] = {}
data['${CONFIG_KEY}']['password'] = '''${PASSWORD}'''
with open('${SECRETS_FILE}', 'w') as f:
    yaml.dump(data, f)
"
        fi
    fi

    SHARE_INDEX=$((SHARE_INDEX + 1))
    echo "  ✓ Added share '${SHARE_NAME}'"
    echo ""
done

if [[ $SHARE_INDEX -eq 0 ]]; then
    echo "No shares configured. You can re-run this script later:"
    echo "  bash $(basename "$0")"
    exit 0
fi

# --- Write to jukebox.yaml ---
echo ""
echo "Writing configuration to ${CONFIG_FILE}..."

"$VIRTUAL_ENV/bin/python3" -c "
from ruamel.yaml import YAML
yaml = YAML()
yaml.preserve_quotes = True
with open('${CONFIG_FILE}', 'r') as f:
    data = yaml.load(f)

# Preserve existing smb config, add/update shares
if '${CONFIG_KEY}' not in data:
    data['${CONFIG_KEY}'] = {}
data['${CONFIG_KEY}']['shares'] = {
    ${SHARES_YAML}
}

with open('${CONFIG_FILE}', 'w') as f:
    yaml.dump(data, f)
" || {
    echo "ERROR: Failed to write configuration to ${CONFIG_FILE}."
    exit 1
}

echo ""
echo "=== SMB MediaProvider configuration complete ==="
echo "Configured ${SHARE_INDEX} share(s)."
echo ""
echo "Next steps:"
echo "  1. Ensure the plugin is enabled in modules.others"
echo "  2. Add credentials to shared/settings/secrets.conf if needed:"
echo "     SMB_USERNAME=your_user"
echo "     SMB_PASSWORD=your_password"
echo "  3. Restart the jukebox: sudo systemctl restart jukebox-daemon"
```

### Neu: `src/jukebox/components/smb/README.md`

```markdown
# SMB Media Provider Plugin

Stellt Musik von **mehreren** SMB/CIFS-Netzwerkfreigaben bereit, **ohne Root-Rechte**.

## Funktionsweise

1. `gio mount` (GVFS) mountet jede SMB-Freigabe benutzerspace
2. Die Mounts erscheinen unter `/run/user/$UID/gvfs/`
3. MPD liest die Dateien nativ — als ob sie lokal wären
4. `mpc update` aktualisiert die MPD-Datenbank
5. Mehrere Shares werden parallel gemountet und via `share_name:/pfad` adressiert

**Kein** eingebetteter HTTP-Server, **kein** pysmb, **kein** mount.cifs.

## Multi-Share

Ein Plugin (`smb.provider`) verwaltet alle Shares intern:

```yaml
smb:
  shares:
    music:
      server: "192.168.1.100"
      share: "music"
    audiobooks:
      server: "192.168.1.100"
      share: "audiobooks"
```

RFID-Karten adressieren Shares über das folder-Format `share_name:/pfad`:

```yaml
rfid_card_01:
  provider: smb
  value: "music:/Album"        # Share "music", Pfad "/Album"
rfid_card_02:
  provider: smb
  value: "audiobooks:/Kapitel1"
```

## Systemanforderungen

- GVFS und GIO müssen installiert sein. Das Plugin liefert ein Installationsskript:
  ```bash
  bash install_dependencies.sh
  ```
- Eine laufende D-Bus Session (auf Raspberry Pi OS standardmäßig vorhanden)

## Secrets-Handling

Username und Passwort werden **nicht** in `jukebox.yaml` gespeichert, sondern
via `retrieve() aus `jukebox.secrets`` aufgelöst:

1. **Environment-Variablen** (`SMB_USERNAME`, `SMB_PASSWORD`) — empfohlen
2. **YAML-Config** (`smb.username`, `smb.password`) — Fallback
3. **Pro-Share-Override** (`smb.shares.<name>.username`, `.password`) — für unterschiedliche Credentials

Das Passwort erscheint **niemals** in CLI-Argumenten (kein `ps aux` Leak).

Siehe [Secrets Handling](../../documentation/develope00a-secrets-infrastructure.md).
```

## Konfiguration

### Erweiterung `resources/default-settings/jukebox.default.yaml`

Der `smb:`-Block erscheint als eigener top-level Config-Key (optional, mit leerer `shares`-Sektion):

```yaml
# SMB Media Provider (optional)
# Aktivieren durch Hinzufügen von 'smb' zu modules.others
# Unterstützt mehrere Shares parallel
smb:
  # shares ist ein dict: share_name → {server, share, username?, password?}
  shares: {}
  # Globale Credentials (für alle Shares, per Share überschreibbar):
  # Werden via retrieve() aus `jukebox.secrets` aus Umgebungsvariablen geladen:
  # SMB_USERNAME, SMB_PASSWORD
  # (optionaler Fallback: direkt hier eintragen)
  username: guest
  password: ""
```

Aktivierung in `modules.others` (ohne `components.`-Präfix):

```yaml
modules:
  others:
    - smb    # ← Wichtig: OHNE 'components.'-Präfix
```

## Installer Contract Compliance

Das SMB-Plugin folgt dem [Plugin-Contract von Milestone 7](07-installer-integration.md).

| Contract-Anforderung | Erfüllung durch SMB |
|---|---|
| Repository-Struktur `src/jukebox/components/smb/` | Dieses Plugin ist im Pfad `src/jukebox/components/smb/` im Repo |
| `__init__.py` mit Plugin-Lifecycle | Siehe `smb/__init__.py` oben |
| `requirements.txt` (optional) | Nicht benötigt — keine zusätzlichen pip-Abhängigkeiten |
| `install_dependencies.sh` (optional) | Installiert `gvfs gvfs-fuse gvfs-backends` und lädt FUSE-Kernelmodul |
| `configure.sh` (optional) | Interaktive Multi-Share-Konfiguration |
| Registry-Eintrag in `plugin_registry.yaml` | Siehe Milestone 7 |

## RPC-Namespace

| RPC | Beschreibung |
|---|---|
| `smb.provider.play_folder("music:/Album")` | Ordner von Share "music" abspielen |
| `smb.provider.play_folder("audiobooks:/Kapitel1")` | Ordner von Share "audiobooks" abspielen |
| `smb.provider.list_all_dirs()` | Alle Shares als Top-Level-Verzeichnisse |
| `smb.provider.get_folder_content("music:/Album")` | Ordnerinhalt eines Shares browsen |
| `smb.provider.list_albums()` | Alben über alle Shares hinweg |
| `smb.provider.get_single_coverart("music:/Album/song.mp3")` | Cover Art |
| `misc.list_providers()` | Alle Provider auflisten (inkl. smb) |

## cards.yaml — Beispiele

```yaml
# Karte für Music-Share
rfid_card_music:
  provider: smb
  value: "music:/Rock/AlbumXYZ"

# Karte für Audiobooks-Share
rfid_card_audiobook:
  provider: smb
  value: "audiobooks:/Kapitel1"

# Karte für NAS-Media-Share
rfid_card_nas:
  provider: smb
  value: "nas_media:/Music/Jazz"
```

## Aktivierung durch den Builder

1. **System-Abhängigkeiten installieren (vom Plugin mitgeliefert):**
   ```bash
   bash src/jukebox/components/smb/install_dependencies.sh
   ```

2. **Plugin in `modules.others` aktivieren:**
   ```yaml
   modules:
     others:
       - smb   # ← Aktivieren (OHNE 'components.' Präfix!)

   smb:
     shares:
       music:
         server: "192.168.1.100"
         share: "music"
       audiobooks:
         server: "192.168.1.100"
         share: "audiobooks"
   ```

3. **Secrets-Datei anlegen** (`shared/settings/secrets.conf`, `chmod 600`):
   ```bash
   # secrets.conf
   SMB_USERNAME=smb_user
   SMB_PASSWORD=smb_geheim
   ```

   Siehe [Secrets Handling](00a-secrets-infrastructure.md) für Details.

4. **Jukebox neustarten:**
   ```bash
   sudo systemctl restart jukebox-daemon.service
   ```

## Tests

### Neu: `test/smb/test_smb_provider.py`

- Test mit gemocktem `subprocess.run` für `gio mount` (pro Share)
- Test: `initialize()` mit Multi-Share-Config → alle Shares werden gemountet
- Test: `initialize()` mit fehlendem `smb.shares` → loggt Fehler
- Test: `initialize()` mit Share ohne `server` → loggt Fehler
- Test: `initialize()` ohne `gio` → loggt Fehler (wird nicht gecrasht)
- Test: `initialize()` übergibt Passwort per stdin (nicht in CLI-Argumenten)
- Test: `initialize()` mit pro-Share-Username überschreibt globalen Username
- Test: `_parse_folder("music:/Album")` → `("music", "/Album")`
- Test: `_parse_folder("audio:/deep/nested")` → `("audio", "/deep/nested")`
- Test: `_parse_folder("noseparator")` → ValueError
- Test: `_parse_folder("unknown:/path")` → ValueError (Share nicht konfiguriert)
- Test: `_remote_to_local("music:/Album")` → korrekter lokaler GVFS-Pfad
- Test: `list_all_dirs()` gibt alle Share-Namen als Verzeichnisse zurück
- Test: `get_folder_content("music:/")` listet Root des Music-Shares
- Test: `get_folder_content("music:/Subdir")` listet Unterverzeichnis
- Test: `list_albums()` aggregiert über alle Shares
- Test: `play_folder("music:/Album")` delegiert an MPD mit lokalem Pfad
- Test: `shutdown()` führt `gio mount -u` für jeden Share aus
- Test: `play_card()` wird NICHT überschrieben (Basisklasse)
- Test: Alle Methoden haben `plugs_callable`-Attribut (`@plugs.tag` wirksam)
- Test: Second-Swipe mit gleichem folder-String über gleichen Share
- Test: Kein Second-Swipe zwischen verschiedenen Shares (unterschiedliche folder-Strings)

## Akzeptanzkriterien

- [ ] `SmbMediaProvider` implementiert alle `MediaProvider`-Methoden
- [ ] Alle RPC-callable Methoden sind mit `@plugs.tag` dekoriert
- [ ] `SmbMediaProvider.play_card()` ist NICHT überschrieben (Basisklasse wird verwendet)
- [ ] Second-Swipe-Verhalten gleich wie bei MPD (globale Einstellung)
- [ ] `play_card_callbacks` werden gefeuert (zentral über Manager)
- [ ] Config-Validierung mit aussagekräftigen Fehlermeldungen (fehlendes `shares`, fehlender `server`/`share`)
- [ ] `gio`-Verfügbarkeitsprüfung vor Mount-Versuch
- [ ] **Mehrere SMB-Shares** werden parallel via `gio mount` gemountet
- [ ] Jeder Share wird unter seinem `share_name` im `_mount_points`-Dict verwaltet
- [ ] MPD liest Dateien nativ vom GVFS-Pfad
- [ ] `play_folder("music:/Album")` mit Share-Präfix delegiert korrekt an MPD mit lokalem Pfad
- [ ] `_parse_folder()` parst das `"share_name:/path"` Format korrekt
- [ ] `_parse_folder()` wirft ValueError bei ungültigem Format oder unbekanntem Share
- [ ] `list_all_dirs()` zeigt alle Share-Namen als Top-Level-Verzeichnisse
- [ ] `get_folder_content()` funktioniert für Share-Root (`"music:/"`) und Unterpfade
- [ ] `list_albums()` aggregiert Alben über alle Shares
- [ ] `get_single_coverart()` delegiert an MPD (Cover Art via Dateizugriff)
- [ ] `smb.provider.*` RPC-Aufrufe funktionieren mit Share-qualifizierten Pfaden
- [ ] `@atexit` dismountet alle SMB-Freigaben sauber
- [ ] SMB-Plugin ist optional (auskommentiert in Default-Config)
- [ ] Kein eingebetteter HTTP-Server, kein pysmb
- [ ] **Username/Passwort via `retrieve() aus `jukebox.secrets`` aus Environment geladen**
- [ ] **Passwort NICHT in CLI-Argumenten (kein `ps aux` Leak)**
- [ ] **Pro-Share-Credentials überschreiben globale Credentials**
- [ ] **Keine Änderungen an `plugs.py`, `MediaProviderManager` oder Card-Routing nötig**

## Bekannte Einschränkungen

1. **D-Bus Abhängigkeit:** `gio mount` benötigt eine laufende D-Bus Session.
2. **Verbindungsabbruch:** Bei SMB-Server-Neustart geht die Verbindung verloren.
3. **Zeichensätze:** GVFS wandelt SMB-Zeichensätze in UTF-8 um.
4. **GVFS-Installation:** GVFS/GIO ist eine externe System-Abhängigkeit. Das Plugin liefert `install_dependencies.sh` mit, das die Pakete installiert. Zusätzlich prüft der Python-Code die Verfügbarkeit und loggt einen aussagekräftigen Fehler, falls `gio` nicht verfügbar ist.
5. **Second-Swipe über Shares:** `"music:/Album"` und `"audiobooks:/Album"` sind unterschiedliche folder-Strings → kein ungewollter Second-Swipe. Dies ist korrektes Verhalten, da es sich um verschiedene Inhalte handelt.