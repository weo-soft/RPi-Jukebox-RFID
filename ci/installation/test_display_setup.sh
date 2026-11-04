#!/usr/bin/env bash

set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(dirname "$SOURCE")"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

TEST_ROOT="$(mktemp -d)"
trap 'rm -rf "${TEST_ROOT}"' EXIT

INSTALLATION_PATH="${REPOSITORY_ROOT}"
SETTINGS_PATH="${TEST_ROOT}/settings"
mkdir -p "${SETTINGS_PATH}" "${TEST_ROOT}/udev" "${TEST_ROOT}/modules-load.d"
mkdir -p "${TEST_ROOT}/backlight/panel"
printf 'display:\n  backlight_device: ""\n' > "${SETTINGS_PATH}/jukebox.yaml"

DISPLAY_UDEV_RULE_TARGET="${TEST_ROOT}/udev/99-phoniebox-backlight.rules"
DISPLAY_MODULES_LOAD_CONF="${TEST_ROOT}/modules-load.d/i2c-dev.conf"
DISPLAY_MODULES_FILE="${TEST_ROOT}/modules"
DISPLAY_BACKLIGHT_ROOT="${TEST_ROOT}/backlight"
touch "${DISPLAY_MODULES_FILE}"

CURRENT_USER="$(id -un)"
CURRENT_USER_GROUP="$(id -gn)"

VIRTUAL_ENV="${TEST_ROOT}/venv"
mkdir -p "${VIRTUAL_ENV}/bin"
cat > "${VIRTUAL_ENV}/bin/python" <<'PYTHON'
#!/usr/bin/env bash
printf 'display:\n  backlight_device: panel\n' > "$2"
exit 0
PYTHON
chmod +x "${VIRTUAL_ENV}/bin/python"

log() {
    :
}

print_lc() {
    :
}

print_c() {
    :
}

clear_c() {
    :
}

exit_on_error() {
    echo "$*" >&2
    exit 1
}

sudo() {
    "$@"
}

id() {
    if [[ "${1:-}" == "-nG" ]]; then
        echo "${CURRENT_USER} video input i2c"
        return 0
    fi
    command id "$@"
}

GROUPADD_CALLS=()
groupadd() {
    GROUPADD_CALLS+=("$*")
}

USERMOD_CALLS=()
usermod() {
    USERMOD_CALLS+=("$*")
}

MODPROBE_CALLS=()
modprobe() {
    MODPROBE_CALLS+=("$*")
}

UDEVADM_CALLS=()
udevadm() {
    UDEVADM_CALLS+=("$*")
}

source "${REPOSITORY_ROOT}/installation/includes/02_helpers.sh"
source "${REPOSITORY_ROOT}/installation/routines/setup_display.sh"

ENABLE_KIOSK_MODE=false
setup_display
[[ ! -e "${DISPLAY_UDEV_RULE_TARGET}" ]]

ENABLE_KIOSK_MODE=true
setup_display

[[ -f "${DISPLAY_UDEV_RULE_TARGET}" ]]
grep -Fq 'SUBSYSTEM=="backlight"' "${DISPLAY_UDEV_RULE_TARGET}"
[[ "$(wc -l < "${DISPLAY_MODULES_LOAD_CONF}")" -eq 1 ]]
[[ "${USERMOD_CALLS[0]}" == "-aG video,input,i2c ${CURRENT_USER}" ]]
[[ " ${MODPROBE_CALLS[*]} " == *" i2c-dev "* ]]
[[ " ${UDEVADM_CALLS[*]} " == *"control --reload-rules"* ]]
[[ " ${UDEVADM_CALLS[*]} " == *"trigger --subsystem-match=backlight"* ]]
grep -Fq 'backlight_device: panel' "${SETTINGS_PATH}/jukebox.yaml"

setup_display
[[ "$(wc -l < "${DISPLAY_MODULES_LOAD_CONF}")" -eq 1 ]]
[[ "${#USERMOD_CALLS[@]}" -eq 2 ]]

printf 'display:\n  backlight_device: ""\n' > "${SETTINGS_PATH}/jukebox.yaml"
cat > "${VIRTUAL_ENV}/bin/python" <<'PYTHON'
#!/usr/bin/env bash
exit 2
PYTHON
chmod +x "${VIRTUAL_ENV}/bin/python"
_display_write_initial_settings

printf 'display:\n  backlight_device: ""\n' > "${SETTINGS_PATH}/jukebox.yaml"
if ( _display_check >/dev/null 2>&1 ); then
    echo "ERROR: _display_check must fail when the unique device is not named" >&2
    exit 1
fi

rm -f "${DISPLAY_UDEV_RULE_TARGET}"
if ( _display_check >/dev/null 2>&1 ); then
    echo "ERROR: _display_check must fail without the udev rule" >&2
    exit 1
fi

echo "test_display_setup: OK"
