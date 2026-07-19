# AGENTS.md — AI Agent Guide for Phoniebox (future3)

This file is intended for AI coding agents (such as Cline) to provide a concise summary of the project's architecture, conventions, and development workflows. It complements `CONTRIBUTING.md` and the `documentation/` folder.

## Project Overview

The **RPi Jukebox RFID Version 3 (future3)** is a complete rewrite of the classic Phoniebox project. It is a **Raspberry Pi-based jukebox** controlled via RFID cards. The software stack consists of a Python3 core application, a React-based web interface, and various plugins for extensibility.

**Key technologies:** Python 3.9+, ZeroMQ (libzmq with draft API), MPD (Music Player Daemon), React/Create React App, YAML configuration, PulseAudio.

---

## 1. Project Structure

### Top-Level Directory Layout

| Path | Purpose |
|---|---|
| `src/jukebox/` | **Jukebox Core App** (Python) |
| `src/jukebox/components/` | Plugin packages (dynamically loaded Python modules) |
| `src/jukebox/jukebox/` | Core framework code (daemon, plugin system, RPC, config) |
| `src/webapp/` | Web Interface (React / Create React App) |
| `documentation/` | All documentation (Markdown) |
| `documentation/builders/` | End-user / builder documentation |
| `documentation/developers/` | Developer documentation |
| `installation/` | Installation scripts |
| `test/` | Python tests (pytest) |
| `docker/` | Docker development environment |
| `resources/` | Default configs, system service files, HTML assets |
| `shared/` | Runtime data (audiofolders, settings, artifacts) |
| `tools/` | Helper tools (RPC CLI, publicity sniffer) |
| `ci/` | CI/CD configuration (Dockerfile for Debian) |

> All folders starting with `scratch*` are ignored by git and flake8 — they are local scratch areas.

---

## 2. Architecture & Design

### Core Architecture

```
┌─────────────┐     ┌──────────────────┐     ┌──────────────┐
│  RFID Reader│────▶│  Jukebox Daemon  │────▶│     MPD      │
│  (Plugin)   │     │  (Python Core)   │     │ (Music Player)│
└─────────────┘     │                  │     └──────────────┘
                    │  ┌────────────┐  │
┌─────────────┐     │  │ RPC Server │  │     ┌──────────────┐
│  Web App    │◀───▶│  │ (ZeroMQ)   │  │────▶│  Publishing  │
│  (React)    │     │  └────────────┘  │     │  (Events)    │
└─────────────┘     └──────────────────┘     └──────────────┘
```

**Key concepts:**

1. **Holistic Python3 application** — no shell script invocations during runtime.
2. **ZeroMQ-based API** — socket-based communication between core and WebUI/clients (using draft API for WebSocket support).
3. **RPC Server** — all user function calls pass through a Remote-Procedure-Call server (`jukebox/rpc/server.py`).
4. **Plugin system** — dynamic loading of Python modules from `components/`, configurable through YAML (`jukebox.plugs`).
5. **Publishing/Subscriber** — event-based messaging (`jukebox.publishing`) for broadcasting state changes.
6. **Config handler** — centralized YAML configuration management (`jukebox.cfghandler`).

### Plugin System (plugs.py)

The plugin system in `jukebox/plugs.py` dynamically loads Python packages and exposes registered callables.

**Registration decorators:**
- `@plugs.register` — register a function or class as callable through the plugin interface
- `@plugs.register(auto_tag=True)` — register a class with all methods automatically callable
- `@plugs.tag` — tag specific methods of a registered class instance as callable
- `@plugs.initialize` — function called immediately after the module is loaded
- `@plugs.finalize` — function called after ALL plugin modules have been loaded
- `@plugs.atexit` — function called during shutdown (receives signal ID)

**Calling plugins:**
```python
import jukebox.plugs as plugin
# Direct call (serialized by thread lock)
result = plugin.call('package', 'plugin', 'method', args=(), kwargs={})
# Call ignoring errors
plugin.call_ignore_errors('package', 'plugin', args=())
# Call in separate daemon thread
thread = plugin.call('package', 'plugin', args=(), as_thread=True)
```

**Lifecycle:**
1. `load_all_named()` / `load_all_unnamed()` — import modules and run `@initialize` functions
2. `load_all_finalize()` — run all `@finalize` functions across all loaded modules
3. Runtime — `call()` / `call_ignore_errors()` for invoking registered callables
4. `close_down()` — run `@atexit` functions in reverse module-load order (during shutdown)

---

## 3. Naming Conventions

**Critical difference from Version 2:** Use underscore `_`, never dash `-` (dashes conflict with Python module imports).

- **Files & folders:** all lowercase, words separated by underscore (`snake_case`)
- **Descriptive wording:** move from general to specific (e.g., `food_fruit_raspberry`, not `raspberry_food_fruit`)
- **Product IDs:** written as-is (uppercase/lowercase preserved), placed last (e.g., `dot_matrix_module_MAX7219`)
- **Python:** follow PEP 8

---

## 4. Key Source Files

| File | Purpose |
|---|---|
| `src/jukebox/jukebox/daemon.py` | Main Jukebox daemon — startup, signal handling, graceful shutdown |
| `src/jukebox/jukebox/plugs.py` | Plugin loading & call dispatcher |
| `src/jukebox/jukebox/cfghandler.py` | YAML configuration handler |
| `src/jukebox/jukebox/rpc/server.py` | ZeroMQ RPC server |
| `src/jukebox/jukebox/rpc/client.py` | ZeroMQ RPC client |
| `src/jukebox/jukebox/publishing/server.py` | ZeroMQ publishing server (events) |
| `src/jukebox/jukebox/NvManager.py` | Non-volatile state manager |
| `src/jukebox/jukebox/multitimer.py` | Multi-timer implementation |
| `src/jukebox/jukebox/playlistgenerator.py` | Playlist generation logic |
| `src/jukebox/jukebox/version.py` | Version information |
| `src/jukebox/jukebox/utils.py` | Various utility functions |
| `src/jukebox/jukebox/callingback.py` | Callback mechanism |
| `src/jukebox/run_jukebox.py` | Entry point for starting the daemon |
| `src/jukebox/run_rpc_tool.py` | CLI RPC tool entry point |

---

## 5. Configuration

Configuration is managed via YAML files through `jukebox.cfghandler`.

- Main config: `shared/settings/jukebox.yaml` (based on `resources/default-settings/jukebox.default.yaml`)
- RFID config: `shared/settings/rfid.yaml`
- Cards database: `shared/settings/cards.yaml`
- Logger config: `shared/settings/logger.yaml`

**Plugin configuration** in `jukebox.yaml` under `modules`:
```yaml
modules:
  named:
    player: components.playermpd        # loaded as 'player' from components.playermpd
    volume: components.volume            # loaded as 'volume' from components.volume
  others:
    - components.rfid                    # loaded under its own name 'rfid'
    - components.controls.event_devices
```

---

## 6. Development Environment Options

### Option A: Docker (recommended for non-hardware work)
- Uses Docker Compose with containers for jukebox, mpd, and webapp
- Hot-reload for webapp; jukebox container must be restarted for Python changes
- See `documentation/developers/docker.md`

### Option B: Raspberry Pi (for hardware work)
- Full setup on RPi, access via SSH
- Follow installation guide, use feature/fork branch

### Option C: Local machine (Linux/Mac/WSL)
- MPD must be installed and configured separately
- Need `pip install pyzmq` (on RPi, pyzmq is compiled from source with draft API)
- Start Jukebox core and WebUI separately

**Note:** All Python scripts must be run within a virtual environment (`.venv`).

---

## 7. Code Quality & Testing

### Linting
- **Python:** `flake8` — run `./run_flake8.sh` from project root
- **Markdown:** `markdownlint-cli2` — run `./run_markdownlint.sh`
- Config files: `.flake8`, `.markdownlint-cli2.yaml`, `.editorconfig`

### Testing
- **Framework:** pytest
- **Run:** `./run_pytest.sh` from project root
- **Coverage:** configured via `.coveragerc`, reported to Coveralls
- Tests are in `test/` directory

### Git Hooks
```bash
cp .githooks/post-merge .git/hooks/.   # for dependency update notifications
cp .githooks/pre-commit .git/hooks/.    # for pre-commit checks (flake8, markdownlint)
```

---

## 8. Running the Application

### Start Jukebox Core
```bash
cd src/jukebox
source .venv/bin/activate
python run_jukebox.py
```

### RPC CLI Tool
```bash
cd tools
./run_rpc_tool.sh                    # interactive mode
./run_rpc_tool.sh -c player.play    # direct command
```

### Publicity Sniffer (event monitoring)
```bash
cd tools
./run_publicity_sniffer.sh
```

### Web App Development
```bash
cd src/webapp
npm install
npm start                            # development server with hot-reload
./run_rebuild.sh -u                  # production build
```

---

## 9. Important Technical Requirements

- **Minimum Python version:** 3.9
- **Target OS:** Raspberry Pi OS (Debian-based)
- **ZeroMQ:** Requires draft API support (custom-built libzmq for armv6/armv7 architectures) — provides WebSocket support
- **WebSocket support:** Not available in stable zeromq releases for RPi → requires custom cross-compilation
- **PulseAudio** for audio routing (can be configured in production for headless operation)
- **MPD** for music playback

---

## 10. Making Changes — Checklist for Agents

When adding features or fixing bugs:

1. [ ] **Understand the plugin architecture** — features should be implemented as plugin packages under `components/`
2. [ ] **Follow naming conventions** — snake_case for files/folders, PEP 8 for Python
3. [ ] **Use the plugin decorators** — `@register`, `@tag`, `@initialize`, `@finalize`, `@atexit` as appropriate
4. [ ] **Add YAML configuration** — support runtime configuration via `jukebox.yaml`
5. [ ] **Add documentation** — Python docstrings for all public APIs, Markdown docs in `documentation/`
6. [ ] **Add tests** — put pytest tests in `test/` directory
7. [ ] **Run linting** — `./run_flake8.sh` and `./run_markdownlint.sh`
8. [ ] **Run tests** — `./run_pytest.sh`
9. [ ] **Commit conventions** — logical atomic commits, prefix trivial changes with `(docs)`, `(maint)`, or `(packaging)`
10. [ ] **Target branch** — base work on `future3/develop`, only target `future3/main` for urgent fixes