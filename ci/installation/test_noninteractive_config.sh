#!/usr/bin/env bash

# Tests for the non-interactive installation support:
# - 01_default_config.sh must not overwrite values set via --config/env (E1).
# - _option_*() functions must skip their interactive prompts when
#   NON_INTERACTIVE=true.
# - The non-interactive code paths in the install scripts: config file
#   loading, existing-installation handling, welcome/finish prompt skipping,
#   install() option consistency and RFID reader module forwarding.

set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(dirname "$SOURCE")"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Stub the console/log helpers used by the installation routines
clear_c() { :; }
print_c() { :; }
log() { :; }
print_lc() { :; }

fail() {
    echo "ERROR: $*" >&2
    exit 1
}

# --- 01_default_config.sh must NOT overwrite pre-set values ---
ENABLE_STATIC_IP="false"
ENABLE_SAMBA="true"
ENABLE_RFID_READER="false"
ENABLE_WEBAPP="false"
DISABLE_BLUETOOTH="false"
SETUP_SPOTIFY="true"
SPOTIFY_REDIRECT_URI="http://example.test/callback"
SPOTIFY_DEVICE_NAME="Kitchen"
ENABLE_JELLYFIN="true"
JELLYFIN_HOST="http://jellyfin.local:8096"
JELLYFIN_API_KEY="secret-key"
source "${REPOSITORY_ROOT}/installation/includes/01_default_config.sh"
[[ "${ENABLE_STATIC_IP}" == "false" ]]
[[ "${ENABLE_SAMBA}" == "true" ]]
[[ "${ENABLE_RFID_READER}" == "false" ]]
[[ "${ENABLE_WEBAPP}" == "false" ]]
[[ "${DISABLE_BLUETOOTH}" == "false" ]]
[[ "${SETUP_SPOTIFY}" == "true" ]]
[[ "${SPOTIFY_REDIRECT_URI}" == "http://example.test/callback" ]]
[[ "${SPOTIFY_DEVICE_NAME}" == "Kitchen" ]]
[[ "${ENABLE_JELLYFIN}" == "true" ]]
[[ "${JELLYFIN_HOST}" == "http://jellyfin.local:8096" ]]
[[ "${JELLYFIN_API_KEY}" == "secret-key" ]]

# Defaults still apply when a variable is unset
unset ENABLE_SAMBA SETUP_SPOTIFY ENABLE_JELLYFIN
source "${REPOSITORY_ROOT}/installation/includes/01_default_config.sh"
[[ "${ENABLE_SAMBA}" == "false" ]]
[[ "${SETUP_SPOTIFY}" == "false" ]]
[[ "${ENABLE_JELLYFIN}" == "false" ]]

# --- _option_*() skip prompts when NON_INTERACTIVE=true ---
source "${REPOSITORY_ROOT}/installation/routines/customize_options.sh"

NON_INTERACTIVE="true"

ENABLE_SAMBA="true"
_option_samba <<< ''
[[ "${ENABLE_SAMBA}" == "true" ]]   # untouched by the prompt

ENABLE_SAMBA="false"
_option_samba <<< 'y'
[[ "${ENABLE_SAMBA}" == "false" ]]  # still untouched

DISABLE_BLUETOOTH="false"
_option_bluetooth <<< ''
[[ "${DISABLE_BLUETOOTH}" == "false" ]]

ENABLE_WEBAPP="false"
_option_webapp <<< ''
[[ "${ENABLE_WEBAPP}" == "false" ]]

ENABLE_RFID_READER="false"
_option_rfid_reader <<< ''
[[ "${ENABLE_RFID_READER}" == "false" ]]

SETUP_SPOTIFY="true"
_option_spotify <<< 'y'
[[ "${SETUP_SPOTIFY}" == "true" ]]  # untouched by the prompt

ENABLE_JELLYFIN="true"
_option_jellyfin <<< 'n'
[[ "${ENABLE_JELLYFIN}" == "true" ]]  # still untouched

# --- setup_jellyfin() uses env-supplied values in non-interactive mode ---
# The real _jellyfin_write_config() runs Python/ruamel, so it is stubbed here;
# the point is to verify that no 'read' prompt is issued and that missing
# credentials disable Jellyfin with a clear message.
SETTINGS_PATH="/tmp"
source "${REPOSITORY_ROOT}/installation/routines/setup_jellyfin.sh"

read() {
    fail "read was called in non-interactive mode"
}
run_with_log_frame() { "$@"; }
print_verify_installation() { :; }
echo() { :; }

NON_INTERACTIVE="true"
JELLYFIN_SETTINGS_FILE="/tmp/phoniebox-test-jellyfin-jukebox.yaml"

WRITE_CALLS=0
_jellyfin_write_config() { WRITE_CALLS=$((WRITE_CALLS + 1)); }

# Missing host → Jellyfin is skipped, nothing is written
ENABLE_JELLYFIN="true"
JELLYFIN_HOST=""
JELLYFIN_API_KEY=""
_jellyfin_set_user_config
[[ "${ENABLE_JELLYFIN}" == "false" ]] || fail "missing Jellyfin host was accepted"
[[ "${WRITE_CALLS}" == "0" ]]          || fail "Jellyfin config was written without a host"

# Host + API key → config is written
ENABLE_JELLYFIN="true"
JELLYFIN_HOST="http://jellyfin.local:8096"
JELLYFIN_API_KEY="secret-key"
JELLYFIN_USERNAME=""
JELLYFIN_PASSWORD=""
_jellyfin_set_user_config
[[ "${ENABLE_JELLYFIN}" == "true" ]] || fail "Jellyfin API key setup failed"
[[ "${WRITE_CALLS}" == "1" ]]        || fail "Jellyfin config was not written once"

# Host + username + password → config is written
ENABLE_JELLYFIN="true"
JELLYFIN_API_KEY=""
JELLYFIN_USERNAME="jelly"
JELLYFIN_PASSWORD="pw"
_jellyfin_set_user_config
[[ "${ENABLE_JELLYFIN}" == "true" ]] || fail "Jellyfin user login setup failed"
[[ "${WRITE_CALLS}" == "2" ]]        || fail "Jellyfin user config was not written once"

# Username without password → Jellyfin is skipped
ENABLE_JELLYFIN="true"
JELLYFIN_USERNAME="jelly"
JELLYFIN_PASSWORD=""
_jellyfin_set_user_config
[[ "${ENABLE_JELLYFIN}" == "false" ]] || fail "Jellyfin user without password was accepted"
[[ "${WRITE_CALLS}" == "2" ]]         || fail "Jellyfin config was written without a password"

unset -f read run_with_log_frame print_verify_installation echo
unset -f _jellyfin_write_config

# --- _load_install_config() and _check_existing_installation() ---
# Both functions are defined in install-jukebox.sh, which runs the actual
# installation when sourced directly. Extract only the function bodies.
source <(
    sed -n \
        -e '/^_load_install_config()/,/^}/p' \
        -e '/^_check_existing_installation()/,/^}/p' \
        "${REPOSITORY_ROOT}/installation/install-jukebox.sh"
)
declare -F _load_install_config >/dev/null || fail "could not extract _load_install_config"
declare -F _check_existing_installation >/dev/null || fail "could not extract _check_existing_installation"

TEST_ROOT=$(mktemp -d)
trap 'rm -rf "${TEST_ROOT}"' EXIT

GIT_REPO_NAME="RPi-Jukebox-RFID"
GIT_USER="MiczFlor"
GIT_BRANCH="future3/main"
GIT_URL="https://github.com/${GIT_USER}/${GIT_REPO_NAME}"

# A flat KEY=VALUE config file is sourced and enables non-interactive mode
INSTALL_CONFIG_FILE="${TEST_ROOT}/install_config.env"
cat > "${INSTALL_CONFIG_FILE}" <<'EOF'
GIT_USER="fork-user"
GIT_BRANCH="feature/test"
ENABLE_SAMBA=true
ENABLE_WEBAPP=true
EXISTING_INSTALL_ACTION=remove
EOF

_load_install_config
[[ "${NON_INTERACTIVE}" == "true" ]]          || fail "NON_INTERACTIVE was not enabled"
[[ "${GIT_USER}" == "fork-user" ]]            || fail "GIT_USER was not loaded from the config"
[[ "${GIT_BRANCH}" == "feature/test" ]]       || fail "GIT_BRANCH was not loaded from the config"
[[ "${GIT_URL}" == "https://github.com/fork-user/RPi-Jukebox-RFID" ]] \
    || fail "GIT_URL was not recomputed after the config override"
[[ "${ENABLE_SAMBA}" == "true" ]]             || fail "ENABLE_SAMBA was not loaded from the config"
[[ "${ENABLE_WEBAPP}" == "true" ]]            || fail "ENABLE_WEBAPP was not loaded from the config"

# A missing config file aborts
INSTALL_CONFIG_FILE="${TEST_ROOT}/missing.env"
if ( _load_install_config ) >/dev/null 2>&1; then
    fail "a missing config file was accepted"
fi
INSTALL_CONFIG_FILE=""

# Existing installation handling in non-interactive mode
INSTALLATION_PATH="${TEST_ROOT}/existing"
NON_INTERACTIVE=true

mkdir -p "${INSTALLATION_PATH}"
EXISTING_INSTALL_ACTION=remove
_check_existing_installation
[[ ! -e "${INSTALLATION_PATH}" ]] || fail "EXISTING_INSTALL_ACTION=remove did not delete the installation"

mkdir -p "${INSTALLATION_PATH}"
EXISTING_INSTALL_ACTION=backup
_check_existing_installation
[[ ! -e "${INSTALLATION_PATH}" ]] || fail "EXISTING_INSTALL_ACTION=backup did not move the installation"
[[ "$(find "${TEST_ROOT}" -maxdepth 1 -name 'existing.bak-*' | wc -l)" -eq 1 ]] \
    || fail "EXISTING_INSTALL_ACTION=backup did not create a backup directory"

mkdir -p "${INSTALLATION_PATH}"
EXISTING_INSTALL_ACTION=bogus
if ( _check_existing_installation ) >/dev/null 2>&1; then
    fail "an unknown EXISTING_INSTALL_ACTION was accepted"
fi

# The interactive flow keeps the hard abort
if ( NON_INTERACTIVE=false; _check_existing_installation ) >/dev/null 2>&1; then
    fail "an interactive rerun over an existing installation was accepted"
fi

# --- welcome() and finish() must not prompt in non-interactive mode ---
source "${REPOSITORY_ROOT}/installation/includes/03_welcome.sh"
source "${REPOSITORY_ROOT}/installation/includes/05_finish.sh"

CAPTURED=()
print_c() { CAPTURED+=("$1"); }
print_lc() { CAPTURED+=("$1"); }

read() {
    fail "read was called in non-interactive mode"
}
sudo() {
    fail "sudo was called in non-interactive mode"
}

NON_INTERACTIVE=true
INSTALLATION_LOGFILE="${TEST_ROOT}/install.log"
FIN_MESSAGE=""
CURRENT_IP_ADDRESS="127.0.0.1"

welcome
[[ "${CAPTURED[${#CAPTURED[@]}-1]}" == *"Starting installation"* ]] \
    || fail "welcome did not continue in non-interactive mode"

CAPTURED=()
finish
[[ "${CAPTURED[${#CAPTURED[@]}-1]}" == *"Reboot skipped (non-interactive mode)"* ]] \
    || fail "finish did not report the skipped reboot"

unset -f read sudo print_c print_lc
print_c() { :; }
print_lc() { :; }

# --- _run_setup_rfid_reader() forwards the module in non-interactive mode ---
source "${REPOSITORY_ROOT}/installation/routines/setup_rfid_reader.sh"

INSTALLATION_PATH="${TEST_ROOT}"
RFID_SCRIPT="${INSTALLATION_PATH}/installation/components/setup_rfid_reader.sh"
mkdir -p "$(dirname "${RFID_SCRIPT}")"
echo '#!/usr/bin/env bash' > "${RFID_SCRIPT}"

RUN_ARGS=()
run_and_print_lc() { RUN_ARGS+=("$*"); }
sudo() { :; }
exit_on_error() { echo "$*" >&2; exit 1; }

NON_INTERACTIVE=true
RFID_READER_MODULE="pn532_i2c_py532"
_run_setup_rfid_reader
[[ "${RUN_ARGS[${#RUN_ARGS[@]}-1]}" == "${RFID_SCRIPT} --reader pn532_i2c_py532 --deps auto --force" ]] \
    || fail "RFID reader module was not forwarded in non-interactive mode"

# An empty module aborts
RFID_READER_MODULE=""
if ( _run_setup_rfid_reader ) >/dev/null 2>&1; then
    fail "an empty RFID_READER_MODULE was accepted"
fi

# Interactive mode passes no reader arguments
NON_INTERACTIVE=false
RUN_ARGS=()
_run_setup_rfid_reader
[[ "${RUN_ARGS[${#RUN_ARGS[@]}-1]}" == "${RFID_SCRIPT}" ]] \
    || fail "interactive mode received unexpected reader arguments"

# A non-zero exit of the reader tool aborts the installation (the tool may
# reject e.g. a reader that cannot be configured without a terminal)
NON_INTERACTIVE=true
RFID_READER_MODULE="generic_usb"
run_and_print_lc() { RUN_ARGS+=("$*"); return 42; }
if ( _run_setup_rfid_reader ) >/dev/null 2>&1; then
    fail "a failing RFID reader configuration was accepted"
fi
run_and_print_lc() { RUN_ARGS+=("$*"); }

unset -f sudo run_and_print_lc exit_on_error

# --- install() enforces option consistency in non-interactive mode ---
source "${REPOSITORY_ROOT}/installation/routines/install.sh"

CALLED=()
customize_options() { CALLED+=("customize_options"); }
_configure_webapp_bundle_download() { CALLED+=("bundle_download"); }
show_slow_hardware_message() { :; }
prepare_dependencies() { :; }
set_raspi_config() { :; }
init_git_repo_from_tardir() { :; }
setup_jukebox_core() { :; }
setup_mpd() { :; }
setup_spotify() { :; }
setup_samba() { :; }
setup_jellyfin() { :; }
setup_jukebox_webapp() { :; }
setup_kiosk_mode() { :; }
setup_rfid_reader() { :; }
optimize_boot_time() { :; }
setup_autohotspot() { :; }
setup_postinstall() { :; }
cleanup() { :; }
run_and_print_lc() { :; }

NON_INTERACTIVE=true
HIFIBERRY_BOARD=""
ENABLE_WEBAPP=false
ENABLE_KIOSK_MODE=true
ENABLE_AUTOHOTSPOT=true
ENABLE_STATIC_IP=true

install
[[ "${ENABLE_KIOSK_MODE}" == "false" ]] || fail "kiosk mode was not disabled without the WebApp"
[[ "${ENABLE_STATIC_IP}" == "false" ]]  || fail "static IP was not disabled with autohotspot"
[[ " ${CALLED[*]} " != *" customize_options "* ]] || fail "customize_options was called in non-interactive mode"

# The WebApp bundle normalization is re-applied when the WebApp is enabled
CALLED=()
ENABLE_WEBAPP=true
install
[[ " ${CALLED[*]} " == *" bundle_download "* ]] || fail "webapp bundle normalization was not applied"

# The interactive path still calls customize_options
CALLED=()
NON_INTERACTIVE=false
install
[[ " ${CALLED[*]} " == *" customize_options "* ]] || fail "customize_options was not called in interactive mode"

echo "Non-interactive config tests passed"
