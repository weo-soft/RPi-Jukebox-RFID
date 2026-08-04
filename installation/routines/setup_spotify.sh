#!/usr/bin/env bash

LIBRESPOT_VERSION="0.8.0"
LIBRESPOT_REVISION="303026bba2af4c31e710afefc3aad4a89e38c812"
LIBRESPOT_REPOSITORY="https://github.com/librespot-org/librespot.git"
LIBRESPOT_SERVICE_PATH="${SYSTEMD_USR_PATH}/librespot.service"
JUKEBOX_SPOTIFY_DROPIN_DIR="${SYSTEMD_USR_PATH}/jukebox-daemon.service.d"
JUKEBOX_SPOTIFY_DROPIN="${JUKEBOX_SPOTIFY_DROPIN_DIR}/spotify.conf"

_spotify_validate_configuration() {
  if [[ -z "${SPOTIFY_CLIENT_ID}" || -z "${SPOTIFY_REDIRECT_URI}" ]]; then
    exit_on_error "Spotify requires a client ID and OAuth redirect URI."
  fi
  if [[ ! "${SPOTIFY_DEVICE_NAME}" =~ ^[A-Za-z0-9._\ -]+$ ]]; then
    exit_on_error "Spotify device names may only contain letters, numbers, spaces, '.', '_', and '-'."
  fi
}

_spotify_install_librespot() {
  print_lc "  Install librespot ${LIBRESPOT_VERSION} (${LIBRESPOT_REVISION:0:8})"

  cargo install librespot \
    --git "${LIBRESPOT_REPOSITORY}" \
    --rev "${LIBRESPOT_REVISION}" \
    --locked \
    --force \
    --root "${HOME_PATH}/.local" \
    --no-default-features \
    --features native-tls,pulseaudio-backend,with-libmdns
}

_spotify_configure() {
  print_lc "  Configure Spotify services"

  mkdir -p "${HOME_PATH}/.cache/librespot"
  python "${INSTALLATION_PATH}/installation/components/configure_spotify.py" \
    "${SETTINGS_PATH}/jukebox.yaml" \
    --client-id "${SPOTIFY_CLIENT_ID}" \
    --redirect-uri "${SPOTIFY_REDIRECT_URI}" \
    --device-name "${SPOTIFY_DEVICE_NAME}"

  sudo cp -f \
    "${INSTALLATION_PATH}/resources/default-services/librespot.service" \
    "${LIBRESPOT_SERVICE_PATH}"
  sudo sed -i \
    "s|%%SPOTIFY_DEVICE_NAME%%|${SPOTIFY_DEVICE_NAME}|g" \
    "${LIBRESPOT_SERVICE_PATH}"
  sudo mkdir -p "${JUKEBOX_SPOTIFY_DROPIN_DIR}"
  sudo cp -f \
    "${INSTALLATION_PATH}/resources/default-services/jukebox-spotify.conf" \
    "${JUKEBOX_SPOTIFY_DROPIN}"
  sudo chmod 644 "${LIBRESPOT_SERVICE_PATH}" "${JUKEBOX_SPOTIFY_DROPIN}"

  systemctl --user daemon-reload
  systemctl --user enable librespot.service

  local message="Spotify is enabled. After reboot, select '${SPOTIFY_DEVICE_NAME}'
once in an official Spotify app, then connect the Web API account under Settings."
  FIN_MESSAGE="${FIN_MESSAGE:+$FIN_MESSAGE\n}${message}"
}

_spotify_check() {
  print_verify_installation

  verify_apt_packages cargo libpulse-dev libssl-dev pkg-config
  "${HOME_PATH}/.local/bin/librespot" --version
  verify_files_chown "${CURRENT_USER}" "${CURRENT_USER_GROUP}" \
    "${HOME_PATH}/.local/bin/librespot" \
    "${HOME_PATH}/.cache/librespot"
  verify_files_chown root root \
    "${LIBRESPOT_SERVICE_PATH}" \
    "${JUKEBOX_SPOTIFY_DROPIN}"
  verify_file_contains_string "backend pulseaudio" "${LIBRESPOT_SERVICE_PATH}"
  verify_file_contains_string "enabled: true" "${SETTINGS_PATH}/jukebox.yaml"
  verify_service_enablement librespot.service enabled --user
}

_run_setup_spotify() {
  _spotify_validate_configuration
  _spotify_install_librespot
  _spotify_configure
  _spotify_check
}

setup_spotify() {
  if [[ "${SETUP_SPOTIFY}" == true ]]; then
    run_with_log_frame _run_setup_spotify "Install Spotify support"
  fi
}
