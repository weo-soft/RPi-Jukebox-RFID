# Installing Phoniebox future3

Welcome! This guide walks you through installing Phoniebox future3 on a Raspberry Pi running **Raspberry Pi OS Lite**.

There are two ways to run the installation:

* **Interactive** — the classic one-line installer that asks a few questions during setup (see [Install Phoniebox software](#install-phoniebox-software)).
* **Non-interactive (headless)** — the same installer, driven by a flat `KEY=VALUE` config file or environment variables, without any prompts. Ideal for automated and scripted installations (see [Non-Interactive Installation](#non-interactive-installation)).

Both modes install the same software; they only differ in how the installation options are supplied.

## Install Raspberry Pi OS Lite

> [!IMPORTANT]
> All Raspberry Pi models are supported. For sufficient performance, **we recommend Pi 2, 3 or Zero 2** (`ARMv7` models). Because Pi 1 or Zero 1 (`ARMv6` models) have limited resources, they are slower (during installation and start up procedure) and might require a bit more work! Pi 4 and 5 are an excess ;-)

Before you can install the Phoniebox software, you need to prepare your Raspberry Pi.

This instruction uses the official [Raspberry Pi Imager](https://www.raspberrypi.com/software/). We recommend using the latest **Raspberry Pi OS Lite** image - Trixie.

### Raspberry Pi Imager

1. Connect a Micro SD card to your computer (preferable an SD card with high read throughput)
1. Start the Raspberry Pi Imager
1. Model: select "No filtering"
1. OS: select **Raspberry Pi OS (other)** and then **Raspberry Pi OS Lite** (64 bit, 32 bit should also work) - the version without Desktop environment
1. Storage: Select your Micro SD card (your card will be formatted)
1. Customize:
    * Hostname: choose hostname for the network (e.g. "phoniebox")
    * Localization: choose according to your location
    * User: choose a username and a password
    * Wifi: provide your wifi settings
    * Remote: enable SSH with "Use password authentication"
1. Click `Write`
1. Confirm the next warning about erasing the SD card with `Yes`
1. Wait for the imaging process to be finished (it'll take a few minutes)
1. Plug the SD into your Pi and optionally connect keyboard, monitor and mouse.

## Install Phoniebox software

Choose how to install: the classic **interactive** one-liner, or the **non-interactive** headless mode. In both cases you can pick which version of Phoniebox to install, then run the corresponding install command in your SSH terminal.

* [Stable Release](#stable-release)
* [Pre-Release](#pre-release)
* [Development](#development)
* [Non-Interactive Installation](#non-interactive-installation)

After a successful installation, [configure your Phoniebox](configuration.md).

Spotify is an optional installer component. Before enabling it, create a
Spotify developer app and choose the OAuth redirect URI for the Phoniebox.
See the [Spotify setup guide](spotify.md#physical-phoniebox-setup).

> [!TIP]
> Depending on your hardware, this installation might last around 60 minutes (usually it's faster, 20-30 min). It refreshes the package index, installs Phoniebox dependencies and applies settings. Be patient and don't let your computer go to sleep. It might disconnect your SSH connection causing the interruption of the installation process. Consider starting the installation in a terminal multiplexer like 'screen' or 'tmux' to avoid this.

The Web App can upload files or complete folder trees, organize the audio
library, and delete files or folders, so Samba is disabled by default during
installation. Choose Samba when you also want direct network access to the
complete `shared` directory, including configuration files. See
[Samba](samba.md) for details.

Current Raspberry Pi OS images normally do not need a full operating system upgrade immediately after imaging, so the installer skips it by default. To opt in to `apt-get full-upgrade` and `autoremove`, prefix an installation command with:

```bash
UPDATE_RASPI_OS=true
```

### Stable Release

This will install the latest **stable release** from the *future3/main* branch.

```bash
cd; bash <(wget -qO- https://raw.githubusercontent.com/MiczFlor/RPi-Jukebox-RFID/future3/main/installation/install-jukebox.sh)
```

### Pre-Release

This will install the latest **pre-release** from the *future3/develop* branch.

```bash
cd; GIT_BRANCH='future3/develop' bash <(wget -qO- https://raw.githubusercontent.com/MiczFlor/RPi-Jukebox-RFID/future3/develop/installation/install-jukebox.sh)
```

### Development

You can also install a specific branch and/or a fork repository. Update the variables to refer to your desired location. (The URL must not necessarily be updated, unless you have actually updated the file being downloaded.)

> [!IMPORTANT]
> A fork repository must be named '*RPi-Jukebox-RFID*' like the official
> repository.

```bash
cd; GIT_USER='your-github-user' GIT_BRANCH='feature/my-change' bash <(wget -qO- https://raw.githubusercontent.com/MiczFlor/RPi-Jukebox-RFID/future3/develop/installation/install-jukebox.sh)
```

The installer uses HTTPS and fetches only the selected branch with shallow history. Set `GIT_USE_SSH=true` to opt in to SSH access. The installed checkout remains a normal tracking branch, so `git pull` works as usual.

Developers who later need all branches, history and tags can fetch them explicitly:

```bash
git fetch --unshallow origin
git fetch origin --tags
```

> [!NOTE]
> The installer deploys a pre-built Web App bundle matching the exact checked-out commit.
> It never compiles the Web App on the Raspberry Pi and never falls back to a bundle from another commit. If a bundle is unavailable, publish or rerun the Web App CI workflow for that commit before retrying the installation. See the developers [Web App](../developers/webapp.md) documentation for details.

### Non-Interactive Installation

For automated or scripted installations you can run the installer **without any interactive prompts**. All options are supplied either as environment variables or through a flat `KEY=VALUE` config file passed with `--config <file>`.

> [!NOTE]
> Behavior in non-interactive mode:
>
> * An existing installation does **not** abort the installer. It is backed up (`EXISTING_INSTALL_ACTION=backup`, the default) or removed (`EXISTING_INSTALL_ACTION=remove`) first.
> * The welcome and the final reboot prompts are skipped. The calling process is responsible for rebooting the Pi afterwards (e.g. `sudo reboot`).
> * If `ENABLE_RFID_READER=true` (the default), you **must** set `RFID_READER_MODULE` to one of the supported reader modules, otherwise the installer aborts.
> * Some reader modules (e.g. `generic_usb`, `generic_nfcpy`, `rc522_spi`) have **no automatic defaults**: they can only be configured interactively (device/pin selection). If you select one of them, the installer runs the reader customization right away — which only works if the installation runs in a **terminal with an interactive prompt** (even with `--config`). Without a terminal the installer **aborts** with a clear message instead of writing an unusable reader configuration. In that case either run the installation from a terminal, or configure the reader afterwards with `run_register_rfid_reader.py` in `src/jukebox`.
>

#### Config file

The config file is a simple `KEY=VALUE` file — no YAML parser is needed on the Pi. Create it on your computer and copy it to the Pi, or create it directly in your SSH session:

```bash
cd
cat > install_config.env <<'EOF'
GIT_USER=MiczFlor
GIT_BRANCH=future3/main
ENABLE_STATIC_IP=false
ENABLE_AUTOHOTSPOT=false
DISABLE_BLUETOOTH=true
DISABLE_ONBOARD_AUDIO=true
ENABLE_RFID_READER=true
RFID_READER_MODULE=pn532_i2c_py532
ENABLE_SAMBA=false
ENABLE_WEBAPP=true
ENABLE_KIOSK_MODE=false
UPDATE_RASPI_OS=false
EXISTING_INSTALL_ACTION=backup
EOF
```

Run the installer with the config file (`--config` implies non-interactive mode):

```bash
cd; bash <(wget -qO- https://raw.githubusercontent.com/MiczFlor/RPi-Jukebox-RFID/future3/main/installation/install-jukebox.sh) --config "$HOME/install_config.env"
```

Alternatively, pass the options as environment variables and enable non-interactive mode with the `--non-interactive` flag:

```bash
cd; NON_INTERACTIVE=true ENABLE_RFID_READER=false bash <(wget -qO- https://raw.githubusercontent.com/MiczFlor/RPi-Jukebox-RFID/future3/main/installation/install-jukebox.sh)
```

Both ways can be combined with the branch/fork variables from the [Development](#development) section:

```bash
cd; GIT_USER='your-github-user' GIT_BRANCH='feature/my-change' bash <(wget -qO- https://raw.githubusercontent.com/MiczFlor/RPi-Jukebox-RFID/future3/develop/installation/install-jukebox.sh) --config "$HOME/install_config.env"
```

#### Run from a local checkout

Developers who have the repository checked out can start the installer directly from the local copy instead of piping it from GitHub:

```bash
cd ~/RPi-Jukebox-RFID
bash installation/install-jukebox.sh --config ~/install_config.env
```

Environment-variable only variant:

```bash
cd ~/RPi-Jukebox-RFID
NON_INTERACTIVE=true ENABLE_RFID_READER=false bash installation/install-jukebox.sh
```

Install your own fork or feature branch:

```bash
cd ~/RPi-Jukebox-RFID
GIT_USER='your-github-user' GIT_BRANCH='feature/my-change' ENABLE_RFID_READER=false bash installation/install-jukebox.sh --non-interactive
```

> [!NOTE]
> The installer always downloads the installation source from GitHub for the configured `GIT_USER`/`GIT_BRANCH` and installs it to `~/RPi-Jukebox-RFID` — running the script from a local checkout does not change that. To test your own fork or feature branch, set `GIT_USER`/`GIT_BRANCH` accordingly (the changes must be pushed). This is the same flow the CI uses in `ci/installation/run_install_noninteractive.sh`.

#### Available options

Every option below is a plain shell variable. Values set via the config file or the environment are kept; anything unset falls back to the listed default.

| Variable | Default | Description |
| --- | --- | --- |
| `GIT_USER` | `MiczFlor` | GitHub user/organisation the source is downloaded from |
| `GIT_BRANCH` | `future3/main` | Branch to install |
| `GIT_USE_SSH` | `false` | Use SSH instead of HTTPS to fetch the source |
| `ENABLE_STATIC_IP` | `true` | Configure a static IP address |
| `ENABLE_AUTOHOTSPOT` | `false` | Enable the WiFi autohotspot fallback service |
| `AUTOHOTSPOT_PROFILE` | `Phoniebox_Hotspot` | Autohotspot profile name |
| `AUTOHOTSPOT_SSID` | profile name | Autohotspot SSID |
| `AUTOHOTSPOT_PASSWORD` | `PlayItLoud!` | Autohotspot password |
| `AUTOHOTSPOT_IP` | `10.0.0.1` | Autohotspot IP address |
| `AUTOHOTSPOT_COUNTRYCODE` | `DE` | Autohotspot WiFi country code |
| `DISABLE_BLUETOOTH` | `true` | Disable Bluetooth |
| `DISABLE_BOOT_SCREEN` | `true` | Disable the boot splash screen |
| `DISABLE_BOOT_LOGS_PRINT` | `true` | Disable boot log output |
| `SETUP_MPD` | `true` | Set up MPD (Music Player Daemon) |
| `ENABLE_MPD_OVERWRITE_INSTALL` | `true` | Overwrite an existing MPD configuration |
| `UPDATE_RASPI_OS` | `false` | Run `apt-get full-upgrade` and `autoremove` |
| `ENABLE_RFID_READER` | `true` | Set up an RFID reader |
| `RFID_READER_MODULE` | – | Reader module, e.g. `pn532_i2c_py532`, `mfrc522_i2c`, `rc522_spi`, `rdm6300_serial`, `generic_usb`, `generic_nfcpy` (required when `ENABLE_RFID_READER=true`) |
| `ENABLE_SAMBA` | `false` | Enable Samba network shares |
| `ENABLE_WEBAPP` | `true` | Install the Web App |
| `ENABLE_WEBAPP_PROD_DOWNLOAD` | `release-only` | Web App bundle download mode (`true` or `release-only`) |
| `ENABLE_KIOSK_MODE` | `false` | Launch the Web App in kiosk mode on boot |
| `DISABLE_ONBOARD_AUDIO` | `false` | Disable the Pi's on-chip audio (recommended with external sound cards) |
| `HIFIBERRY_BOARD` | – | HiFiBerry HAT to enable, e.g. `hifiberry-dac`, `hifiberry-dacplus` |
| `SETUP_SPOTIFY` | `false` | Install Spotify playback support (librespot + Web App OAuth) |
| `SPOTIFY_CLIENT_ID` | – | Spotify developer app client ID (required when `SETUP_SPOTIFY=true`) |
| `SPOTIFY_REDIRECT_URI` | (see below) | Exact OAuth redirect URI of the Spotify developer app |
| `SPOTIFY_DEVICE_NAME` | `Phoniebox` | Name under which the Phoniebox appears in Spotify apps |
| `LIBRESPOT_ALLOW_SOURCE_BUILD` | `false` | Compile librespot from source if no prebuilt binary matches |
| `ENABLE_JELLYFIN` | `false` | Configure the Jellyfin player backend in `jukebox.yaml` |
| `JELLYFIN_HOST` | – | Jellyfin server URL, e.g. `http://jellyfin.local:8096` (required when `ENABLE_JELLYFIN=true`) |
| `JELLYFIN_API_KEY` | – | Jellyfin API key (Dashboard → API Keys); alternative to user login |
| `JELLYFIN_USERNAME` | – | Jellyfin username; requires `JELLYFIN_PASSWORD` |
| `JELLYFIN_PASSWORD` | – | Jellyfin password (used together with `JELLYFIN_USERNAME`) |
| `EXISTING_INSTALL_ACTION` | `backup` | Handling of an existing installation: `backup` or `remove` |

The Spotify/Jellyfin options replace the interactive Spotify/Jellyfin setup
prompts. The default OAuth redirect
URI is `http://127.0.0.1:3000/api/v1/spotify/oauth/callback`. Jellyfin accepts
either an API key or a username/password pair; at least one authentication
method must be provided.

The installer prints the log file path to the console (e.g. `INSTALLATION_LOGFILE=/home/pi/INSTALL-1234567890.log`) so a calling process can follow the installation live — see [Logs](#logs) below.

### Logs

To follow the installation closely, use this command in another terminal.

```bash
cd; tail -f INSTALL-<fullname>.log
```
