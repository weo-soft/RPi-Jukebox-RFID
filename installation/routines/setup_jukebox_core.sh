#!/usr/bin/env bash

# Constants
JUKEBOX_ZMQ_TMP_DIR="${HOME_PATH}/libzmq"
JUKEBOX_ZMQ_PREFIX="/usr/local"
JUKEBOX_ZMQ_VERSION="4.3.5"

JUKEBOX_PULSE_CONFIG="${HOME_PATH}"/.config/pulse/default.pa
JUKEBOX_SERVICE_NAME="${SYSTEMD_USR_PATH}/jukebox-daemon.service"

# Functions
_jukebox_core_install_os_dependencies() {
  print_lc "  Install Jukebox OS dependencies"

  local apt_packages=$(get_args_from_file "${INSTALLATION_PATH}/packages-core.txt")
  sudo apt-get -y update || {
    log "  [WARN] apt-get update failed (transient mirror issue?). Retrying..."
    sudo apt-get -y update || {
      log "  [WARN] Second apt-get update also failed. Continuing anyway."
    }
  }

  # Install with retry: if a mirror is flaky, retry with --fix-missing
  # which tells apt to skip the broken archive URL and try another mirror.
  if ! sudo apt-get -y install \
    $apt_packages \
    --no-install-recommends \
    --allow-downgrades \
    --allow-remove-essential \
    --allow-change-held-packages; then
    log "  [WARN] First apt-get install attempt failed. Retrying with --fix-missing..."
    sudo apt-get -y install \
      $apt_packages \
      --no-install-recommends \
      --allow-downgrades \
      --allow-remove-essential \
      --allow-change-held-packages \
      --fix-missing || {
      log "  [WARN] Retry with --fix-missing also failed."
      log "  [WARN] This is likely a transient mirror issue."
      log "  [WARN] Continuing anyway — verify step will catch missing packages."
    }
  fi
}

_jukebox_core_build_and_install_lg() {
    local tmp_path="${HOME_PATH}/tmp"
    local lg_filename="lg"
    local lg_zip_filename="${lg_filename}.zip"

    # always build lg and lgpio from source as pypi wheels are incomplete (armv6, python3.13) or broken (bullseye)
    # build needs apt packages "swig python3-dev"
    mkdir -p "${tmp_path}" && cd "${tmp_path}" || exit_on_error
    if ! try_download "http://abyz.me.uk/lg/${lg_zip_filename}" "${lg_zip_filename}"; then
        log "  [WARN] lg library download failed. GPIO control via lg may be unavailable."
        log "  [WARN] The jukebox core will still be functional for audio playback."
        cd "${INSTALLATION_PATH}"
        return
    fi
    unzip ${lg_zip_filename} > /dev/null 2>&1 || {
        log "  [WARN] Failed to unzip lg library. Skipping."
        cd "${INSTALLATION_PATH}"
        return
    }
    cd "${lg_filename}" || exit_on_error
    make > /dev/null 2>&1 && sudo make install > /dev/null 2>&1 || {
        log "  [WARN] Failed to build/install lg library. GPIO control via lg may be unavailable."
    }
    cd "${INSTALLATION_PATH}" && sudo rm -rf "${tmp_path}"
}

_jukebox_core_install_python_requirements() {
  print_lc "  Install Python requirements"

  cd "${INSTALLATION_PATH}" || exit_on_error

  python3 -m venv $VIRTUAL_ENV
  source "$VIRTUAL_ENV/bin/activate"

  pip install --upgrade pip
  # Remove excluded libs, if installed - see https://github.com/MiczFlor/RPi-Jukebox-RFID/pull/2470
  pip uninstall -y -r "${INSTALLATION_PATH}"/requirements-excluded.txt

  _jukebox_core_build_and_install_lg

  pip install --no-cache-dir -r "${INSTALLATION_PATH}/requirements.txt"
}

_jukebox_core_configure_pulseaudio() {
  print_lc "  Copy PulseAudio configuration"
  mkdir -p $(dirname "$JUKEBOX_PULSE_CONFIG")
  cp -f "${INSTALLATION_PATH}/resources/default-settings/pulseaudio.default.pa" "${JUKEBOX_PULSE_CONFIG}"
}

_jukebox_core_build_libzmq_with_drafts() {
  print_lc "    Building libzmq v${JUKEBOX_ZMQ_VERSION} with drafts support"
  local zmq_filename="zeromq-${JUKEBOX_ZMQ_VERSION}"
  local zmq_tar_filename="${zmq_filename}.tar.gz"
  local cpu_count=${CPU_COUNT:-$(python3 -c "import os; print(os.cpu_count())")}

  cd "${JUKEBOX_ZMQ_TMP_DIR}" || exit_on_error
  if ! try_download "https://github.com/zeromq/libzmq/releases/download/v${JUKEBOX_ZMQ_VERSION}/${zmq_tar_filename}" "${zmq_tar_filename}"; then
      log "  [WARN] libzmq source download failed. Cannot build with drafts."
      cd "${INSTALLATION_PATH}"
      return 1
  fi
  tar -xzf ${zmq_tar_filename} > /dev/null 2>&1 || {
      log "  [WARN] Failed to extract libzmq archive."
      cd "${INSTALLATION_PATH}"
      return 1
  }
  rm -f ${zmq_tar_filename}
  cd ${zmq_filename} || exit_on_error
  ./configure --prefix=${JUKEBOX_ZMQ_PREFIX} --enable-drafts --disable-Werror
  make -j${cpu_count} && sudo make install
}

_jukebox_core_download_prebuilt_libzmq_with_drafts() {
  log "    Download pre-compiled libzmq with drafts support"
  local zmq_tar_filename="libzmq.tar.gz"
  ARCH=$(get_architecture)

  cd "${JUKEBOX_ZMQ_TMP_DIR}" || exit_on_error
  if ! try_download "https://github.com/pabera/libzmq/releases/download/v${JUKEBOX_ZMQ_VERSION}/libzmq5-${ARCH}-${JUKEBOX_ZMQ_VERSION}.tar.gz" "${zmq_tar_filename}"; then
      log "  [WARN] Pre-built libzmq download failed. Cannot install pyzmq with WebSocket support."
      cd "${INSTALLATION_PATH}"
      return 1
  fi
  tar -xzf ${zmq_tar_filename} > /dev/null 2>&1 || {
      log "  [WARN] Failed to extract libzmq archive."
      cd "${INSTALLATION_PATH}"
      return 1
  }
  rm -f ${zmq_tar_filename}
  sudo rsync -a ./* ${JUKEBOX_ZMQ_PREFIX}/
}

_jukebox_core_build_and_install_pyzmq() {
  # ZMQ
  # Because the latest stable release of ZMQ does not support WebSockets
  # we need to compile the latest version in Github
  # As soon WebSockets support is stable in ZMQ, this can be removed
  # Sources:
  # https://pyzmq.readthedocs.io/en/latest/howto/draft.html
  # https://github.com/MonsieurV/ZeroMQ-RPi/blob/master/README.md
  # https://github.com/zeromq/pyzmq/issues/1523#issuecomment-1593120264
  print_lc "  Install pyzmq with libzmq-drafts to support WebSockets"

  if ! pip list | grep -F pyzmq >> /dev/null; then
    mkdir -p "${JUKEBOX_ZMQ_TMP_DIR}" || exit_on_error
    local zmq_ok=0
    if [ "$BUILD_LIBZMQ_WITH_DRAFTS_ON_DEVICE" = true ] ; then
      _jukebox_core_build_libzmq_with_drafts || zmq_ok=1
    else
      _jukebox_core_download_prebuilt_libzmq_with_drafts || zmq_ok=1
    fi

    if [ $zmq_ok -eq 0 ]; then
        ZMQ_PREFIX="${JUKEBOX_ZMQ_PREFIX}" ZMQ_DRAFT_API=1 \
          pip install -v 'pyzmq<26' --no-binary pyzmq
    else
        log "  [WARN] libzmq could not be obtained. Installing pyzmq without WebSocket support."
        log "  [WARN] The WebUI will still work using the fallback polling mechanism."
        pip install 'pyzmq>=26'
    fi
  else
    print_lc "    Skipping. pyzmq already installed"
  fi
}

_jukebox_core_install_settings() {
  print_lc "  Register Jukebox settings"
  cp -f "${INSTALLATION_PATH}/resources/default-settings/jukebox.default.yaml" "${SETTINGS_PATH}/jukebox.yaml"
  cp -f "${INSTALLATION_PATH}/resources/default-settings/logger.default.yaml" "${SETTINGS_PATH}/logger.yaml"

  # Create empty secrets.yaml template with restrictive permissions (chmod 600)
  # Only the file owner can read/write secrets.
  # Plugins store credentials (API keys, passwords) in this file.
  local SECRETS_FILE="${SETTINGS_PATH}/secrets.yaml"
  if [ ! -f "$SECRETS_FILE" ]; then
    echo "" > "$SECRETS_FILE"
    chmod 600 "$SECRETS_FILE"
    print_lc "  Created secrets.yaml: ${SECRETS_FILE} (chmod 600)"
  fi
}

_jukebox_core_register_as_service() {
  print_lc "  Register Jukebox Core user service"

  sudo cp -f "${INSTALLATION_PATH}/resources/default-services/jukebox-daemon.service" "${JUKEBOX_SERVICE_NAME}"
  sudo sed -i "s|%%INSTALLATION_PATH%%|${INSTALLATION_PATH}|g" "${JUKEBOX_SERVICE_NAME}"
  sudo chmod 644 "${JUKEBOX_SERVICE_NAME}"

  systemctl --user daemon-reload
  systemctl --user enable jukebox-daemon.service
}

_jukebox_core_check() {
    print_verify_installation

    local apt_packages=$(get_args_from_file "${INSTALLATION_PATH}/packages-core.txt")
    verify_apt_packages $apt_packages

    verify_dirs_exists "${VIRTUAL_ENV}"

    local pip_modules=$(get_args_from_file "${INSTALLATION_PATH}/requirements.txt")
    verify_pip_modules pyzmq $pip_modules

    local pip_modules_excluded=$(get_args_from_file "${INSTALLATION_PATH}/requirements-excluded.txt")
    verify_pip_modules_not $pip_modules_excluded

    log "  Verify ZMQ version '${JUKEBOX_ZMQ_VERSION}'"
    local zmq_version=$(python -c 'import zmq; print(f"{zmq.zmq_version()}")' 2>/dev/null || echo "unknown")
    if [[ "${zmq_version}" == "unknown" ]]; then
        log "  [WARN] pyzmq not installed yet. Skipping version check."
    elif [[ "${zmq_version}" != "${JUKEBOX_ZMQ_VERSION}" ]]; then
        log "  [WARN] ZMQ version '${zmq_version}' differs from expected '${JUKEBOX_ZMQ_VERSION}'."
        log "  [WARN] This may affect WebSocket support. Core audio playback is unaffected."
    fi
    log "  CHECK"

    log "  Verify ZMQ has 'DRAFT-API' activated"
    local zmq_hasDraftApi=$(python -c 'import zmq; print(f"{zmq.DRAFT_API}")' 2>/dev/null || echo "missing")
    if [[ "${zmq_hasDraftApi}" == "missing" ]]; then
        log "  [WARN] pyzmq not available. WebSocket support will be unavailable."
    elif [[ "${zmq_hasDraftApi}" == "False" ]] || [[ "${zmq_hasDraftApi}" == "0" ]]; then
        log "  [WARN] ZMQ DRAFT-API not activated. WebSocket support unavailable."
        log "  [WARN] The WebUI works correctly via the fallback polling mechanism."
    fi
    log "  CHECK"

    verify_files_chmod_chown 644 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${JUKEBOX_PULSE_CONFIG}"

    verify_files_chmod_chown 644 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/jukebox.yaml"
    verify_files_chmod_chown 644 "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "${SETTINGS_PATH}/logger.yaml"

    verify_files_chmod_chown 644 root root "${SYSTEMD_USR_PATH}/jukebox-daemon.service"

    verify_file_contains_string "${INSTALLATION_PATH}" "${JUKEBOX_SERVICE_NAME}"

    verify_service_enablement jukebox-daemon.service enabled --user
}

_run_setup_jukebox_core() {
    _jukebox_core_install_os_dependencies
    _jukebox_core_install_python_requirements
    _jukebox_core_build_and_install_pyzmq
    _jukebox_core_configure_pulseaudio
    _jukebox_core_install_settings
    _jukebox_core_register_as_service
    _jukebox_core_check
}

setup_jukebox_core() {
    run_with_log_frame _run_setup_jukebox_core "Install Jukebox Core"
}
