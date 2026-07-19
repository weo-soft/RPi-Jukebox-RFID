install() {
  # [DEBUG] Install entry point
  log "  [DEBUG] install() entered at $(date -u '+%Y-%m-%d %H:%M:%S UTC')"
  log "  [DEBUG] INSTALLATION_PATH='${INSTALLATION_PATH}', GIT_USER='${GIT_USER}', GIT_BRANCH='${GIT_BRANCH}'"
  log "  [DEBUG] CURRENT_USER='${CURRENT_USER}', HOME_PATH='${HOME_PATH}'"
  log "  [DEBUG] SETTINGS_PATH='${SETTINGS_PATH}', VIRTUAL_ENV='${VIRTUAL_ENV}'"
  log "  [DEBUG] SELECTED_PLUGINS='${SELECTED_PLUGINS}', CUSTOM_PLUGINS='${CUSTOM_PLUGINS}'"
  log "  [DEBUG] PLUGIN_REGISTRY file exists: $(test -f "${INSTALLATION_PATH}/resources/default-settings/plugin_registry.yaml" && echo 'YES' || echo 'NO')"

  clear_c
  customize_options
  clear_c
  show_slow_hardware_message
  set_raspi_config
  set_ssh_qos
  update_raspi_os
  init_git_repo_from_tardir
  setup_jukebox_core
  setup_plugins
  setup_mpd
  setup_samba
  setup_jukebox_webapp
  setup_kiosk_mode
  setup_rfid_reader
  optimize_boot_time
  setup_autohotspot
  setup_postinstall
  cleanup
}
