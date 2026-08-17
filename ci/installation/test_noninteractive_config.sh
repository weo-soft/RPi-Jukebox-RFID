#!/usr/bin/env bash

# Tests for the non-interactive installation support:
# - 01_default_config.sh must not overwrite values set via --config/env (E1).
# - _option_*() functions must skip their interactive prompts when
#   NON_INTERACTIVE=true.

set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(dirname "$SOURCE")"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

# Stub the console/log helpers used by the installation routines
clear_c() { :; }
print_c() { :; }
log() { :; }
print_lc() { :; }

# --- 01_default_config.sh must NOT overwrite pre-set values ---
ENABLE_STATIC_IP="false"
DISABLE_IPv6="false"
ENABLE_SAMBA="true"
ENABLE_RFID_READER="false"
ENABLE_WEBAPP="false"
DISABLE_BLUETOOTH="false"
source "${REPOSITORY_ROOT}/installation/includes/01_default_config.sh"
[[ "${ENABLE_STATIC_IP}" == "false" ]]
[[ "${DISABLE_IPv6}" == "false" ]]
[[ "${ENABLE_SAMBA}" == "true" ]]
[[ "${ENABLE_RFID_READER}" == "false" ]]
[[ "${ENABLE_WEBAPP}" == "false" ]]
[[ "${DISABLE_BLUETOOTH}" == "false" ]]

# Defaults still apply when a variable is unset
unset ENABLE_SAMBA
source "${REPOSITORY_ROOT}/installation/includes/01_default_config.sh"
[[ "${ENABLE_SAMBA}" == "false" ]]

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

echo "Non-interactive config tests passed"
