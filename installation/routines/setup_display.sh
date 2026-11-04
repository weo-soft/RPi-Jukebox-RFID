#!/usr/bin/env bash

DISPLAY_UDEV_RULE_SOURCE="${INSTALLATION_PATH}/resources/system/99-phoniebox-backlight.rules"
DISPLAY_UDEV_RULE_TARGET="${DISPLAY_UDEV_RULE_TARGET:-/etc/udev/rules.d/99-phoniebox-backlight.rules}"
DISPLAY_MODULES_LOAD_CONF="${DISPLAY_MODULES_LOAD_CONF:-/etc/modules-load.d/i2c-dev.conf}"
DISPLAY_MODULES_FILE="${DISPLAY_MODULES_FILE:-/etc/modules}"

_display_install_udev_rule() {
    local source="${DISPLAY_UDEV_RULE_SOURCE}"
    local target="${DISPLAY_UDEV_RULE_TARGET}"

    if [[ ! -f "${source}" ]]; then
        exit_on_error "ERROR: Backlight udev rule not found: ${source}"
    fi

    sudo mkdir -p "$(dirname "${target}")"
    sudo cp -f "${source}" "${target}"
    sudo chmod 644 "${target}"

    if command -v udevadm >/dev/null 2>&1; then
        sudo udevadm control --reload-rules
        sudo udevadm trigger --subsystem-match=backlight
    else
        log "  udevadm not available; the rule applies on the next boot"
    fi
    log "  Installed backlight udev rule: ${target}"
}

_display_add_user_to_groups() {
    local user="${CURRENT_USER:-$(whoami)}"

    sudo groupadd -f video
    sudo groupadd -f input
    sudo groupadd -f i2c
    sudo usermod -aG video,input,i2c "${user}"
    log "  Added '${user}' to video, input and i2c (effective after the next login)"
}

_display_enable_i2c_dev() {
    if [[ -d "$(dirname "${DISPLAY_MODULES_LOAD_CONF}")" ]]; then
        echo "i2c-dev" | sudo tee "${DISPLAY_MODULES_LOAD_CONF}" > /dev/null
    elif ! grep -qx "i2c-dev" "${DISPLAY_MODULES_FILE}" 2>/dev/null; then
        echo "i2c-dev" | sudo tee -a "${DISPLAY_MODULES_FILE}" > /dev/null
    fi
    sudo modprobe i2c-dev 2>/dev/null || log "  i2c-dev not loaded; DDC/CI starts after the next boot"
}

_display_check() {
    print_verify_installation

    verify_files_exists "${DISPLAY_UDEV_RULE_TARGET}"
    verify_file_contains_string 'SUBSYSTEM=="backlight"' "${DISPLAY_UDEV_RULE_TARGET}"

    local user="${CURRENT_USER:-$(whoami)}"
    local group
    local groups=" $(id -nG "${user}") "
    for group in video input i2c; do
        if [[ "${groups}" != *" ${group} "* ]]; then
            exit_on_error "ERROR: user '${user}' is not in group '${group}'"
        fi
    done
    log "  CHECK"

    verify_files_exists "${SETTINGS_PATH}/jukebox.yaml"
    verify_file_contains_string "backlight_device:" "${SETTINGS_PATH}/jukebox.yaml"
}

_run_setup_display() {
    _display_install_udev_rule
    _display_add_user_to_groups
    _display_enable_i2c_dev
    _display_check
}

setup_display() {
    if [ "${ENABLE_KIOSK_MODE:-false}" == true ] ; then
        run_with_log_frame _run_setup_display "Setup Display"
    fi
}
