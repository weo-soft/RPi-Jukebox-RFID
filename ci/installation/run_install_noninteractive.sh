#!/usr/bin/env bash

# Install Phoniebox and test it (non-interactive mode)
# Used e.g. for tests on Docker

# Objective:
# Test the non-interactive installation path. All options are supplied via a
# flat KEY=VALUE config file (--config) instead of interactive prompts, as it
# is used for headless/automated installations. Mirrors the common interactive
# path (see run_install_common.sh).

SOURCE="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(dirname "$SOURCE")"
LOCAL_INSTALL_SCRIPT_PATH="${INSTALL_SCRIPT_PATH:-${SCRIPT_DIR}/../../installation}"
LOCAL_INSTALL_SCRIPT_PATH="${LOCAL_INSTALL_SCRIPT_PATH%/}"

CONFIG_FILE="$(mktemp)"
trap 'rm -f "${CONFIG_FILE}"' EXIT

# Non-interactive installation options (flat KEY=VALUE file, see
# install-jukebox.sh --config). Equivalent of the interactive answers in
# run_install_common.sh:
#   y - start setup
#   n - use static ip
#   n - deactivate ipv6
#   y - setup autohotspot
#   n -   change default configuration
#   n - deactivate bluetooth
#   n - disable on-chip audio
#   n - setup rfid reader
#   y - setup samba
#   y - setup webapp
#   - - exact Web App bundle download (forced)
#   n - setup kiosk mode
#   (the reboot is left to the calling process in non-interactive mode)
cat > "${CONFIG_FILE}" <<'EOF'
ENABLE_STATIC_IP=false
DISABLE_IPv6=false
ENABLE_AUTOHOTSPOT=true
DISABLE_BLUETOOTH=false
DISABLE_ONBOARD_AUDIO=false
ENABLE_RFID_READER=false
ENABLE_SAMBA=true
ENABLE_WEBAPP=true
ENABLE_WEBAPP_PROD_DOWNLOAD=true
ENABLE_KIOSK_MODE=false
EXISTING_INSTALL_ACTION=remove
EOF

# Run installation (in non-interactive mode): all options come from the
# config file, no interactive 'read' prompts are issued.
"${LOCAL_INSTALL_SCRIPT_PATH}/install-jukebox.sh" --config "${CONFIG_FILE}"
