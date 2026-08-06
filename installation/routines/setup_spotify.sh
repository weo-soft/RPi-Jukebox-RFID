#!/usr/bin/env bash

LIBRESPOT_VERSION="0.8.0"
LIBRESPOT_REVISION="303026bba2af4c31e710afefc3aad4a89e38c812"
LIBRESPOT_REPOSITORY="https://github.com/librespot-org/librespot.git"
LIBRESPOT_BUILD_DEPENDENCIES=(cargo libpulse-dev libssl-dev pkg-config)
LIBRESPOT_BUILD_DEPENDENCIES_TO_REMOVE=()
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

_spotify_install_build_dependencies() {
  print_lc "  Install librespot build dependencies"

  LIBRESPOT_BUILD_DEPENDENCIES_TO_REMOVE=()
  local package
  for package in "${LIBRESPOT_BUILD_DEPENDENCIES[@]}"; do
    if ! dpkg-query -W -f='${Status}' "${package}" 2>/dev/null \
        | grep -qx "install ok installed"; then
      LIBRESPOT_BUILD_DEPENDENCIES_TO_REMOVE+=("${package}")
    fi
  done

  if ! sudo apt-get -y install \
      --no-install-recommends \
      "${LIBRESPOT_BUILD_DEPENDENCIES[@]}"; then
    if ! _spotify_cleanup_build_dependencies; then
      print_lc "  Warning: failed to remove librespot build dependencies."
    fi
    exit_on_error "Failed to install librespot build dependencies."
  fi
}

_spotify_runtime_package_owners() {
  local binary="${HOME_PATH}/.local/bin/librespot"
  [[ -x "${binary}" ]] || return

  local library
  local owner
  while IFS= read -r library; do
    owner="$(dpkg-query -S "${library}" 2>/dev/null | head -n 1)"
    if [[ -z "${owner}" ]]; then
      library="$(readlink -f "${library}")"
      owner="$(dpkg-query -S "${library}" 2>/dev/null | head -n 1)"
    fi
    if [[ -n "${owner}" ]]; then
      printf '%s\n' "${owner%%: /*}"
    fi
  done < <(
    ldd "${binary}" \
      | awk '$2 == "=>" && $3 ~ /^\// { print $3 }
             $1 ~ /^\// { print $1 }'
  )
}

_spotify_cleanup_build_dependencies() {
  if [[ "${#LIBRESPOT_BUILD_DEPENDENCIES_TO_REMOVE[@]}" -eq 0 ]]; then
    return
  fi

  print_lc "  Remove librespot build dependencies"

  local runtime_packages=()
  local package
  while IFS= read -r package; do
    [[ -n "${package}" ]] && runtime_packages+=("${package}")
  done < <(_spotify_runtime_package_owners | sort -u)

  if [[ "${#runtime_packages[@]}" -gt 0 ]]; then
    sudo apt-mark manual "${runtime_packages[@]}" >/dev/null || return 1
  fi

  sudo apt-get -y purge \
    "${LIBRESPOT_BUILD_DEPENDENCIES_TO_REMOVE[@]}" || return 1
  sudo apt-get -y autoremove --purge || return 1
}

_spotify_install_librespot() {
  print_lc "  Install librespot ${LIBRESPOT_VERSION} (${LIBRESPOT_REVISION:0:8})"

  local cargo_tmp_dir
  mkdir -p "${HOME_PATH}/.cache" \
    || exit_on_error "Failed to create the librespot build directory."
  cargo_tmp_dir="$(mktemp -d "${HOME_PATH}/.cache/librespot-build.XXXXXX")" \
    || exit_on_error "Failed to create the librespot build directory."

  # Raspberry Pi OS mounts /tmp as a small tmpfs. Build on persistent storage.
  if ! CARGO_HOME="${cargo_tmp_dir}/cargo-home" \
      TMPDIR="${cargo_tmp_dir}" cargo install librespot \
      --git "${LIBRESPOT_REPOSITORY}" \
      --rev "${LIBRESPOT_REVISION}" \
      --locked \
      --force \
      --root "${HOME_PATH}/.local" \
      --no-default-features \
      --features native-tls,pulseaudio-backend,with-libmdns; then
    rm -rf "${cargo_tmp_dir}"
    if ! _spotify_cleanup_build_dependencies; then
      print_lc "  Warning: failed to remove librespot build dependencies."
    fi
    exit_on_error "Failed to compile and install librespot."
  fi

  rm -rf "${cargo_tmp_dir}"
  _spotify_cleanup_build_dependencies \
    || exit_on_error "Failed to remove librespot build dependencies."
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

  "${HOME_PATH}/.local/bin/librespot" --version \
    || exit_on_error "The librespot binary cannot be executed."
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
  _spotify_install_build_dependencies
  _spotify_install_librespot
  _spotify_configure
  _spotify_check
}

setup_spotify() {
  if [[ "${SETUP_SPOTIFY}" == true ]]; then
    run_with_log_frame _run_setup_spotify "Install Spotify support"
  fi
}
