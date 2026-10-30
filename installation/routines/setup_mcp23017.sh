#!/usr/bin/env bash

# Marker line that identifies the block this routine owns in the boot
# configuration. It is written once and keeps the setup idempotent.
MCP23017_BOOT_MARKER="# MCP23017 I2C GPIO expander"

warn_mcp23017() {
  echo "WARNING: $*" >&2
}

setup_mcp23017() {
  if [ "${ENABLE_MCP23017:-false}" == true ]; then
    run_with_log_frame _run_setup_mcp23017 "Install MCP23017 buttons"
  fi
}

_run_setup_mcp23017() {
  _mcp23017_require_i2c_tools
  _mcp23017_apply_boot_config "$(get_boot_config_path)"
  _mcp23017_enable_i2c_dev
  _mcp23017_add_user_to_groups
  _mcp23017_install_settings
  _mcp23017_check_hardware
  _mcp23017_add_fin_message
}

_mcp23017_require_i2c_tools() {
  local tool
  for tool in i2cset i2cget; do
    if ! command -v "$tool" > /dev/null 2>&1; then
      exit_on_error "ERROR: '$tool' is missing. Install the 'i2c-tools' package."
    fi
  done
}

# Add the overlay block to the boot configuration. The file is passed in, so
# the function can be tested without touching /boot.
_mcp23017_apply_boot_config() {
  local config_file="$1"
  local address="${MCP23017_ADDRESS:-0x20}"
  local bus="${MCP23017_I2C_BUS:-1}"
  local existing

  if [ ! -f "$config_file" ]; then
    warn_mcp23017 "Boot configuration '$config_file' not found; skipping the overlay."
    return 0
  fi
  if grep -qF "$MCP23017_BOOT_MARKER" "$config_file"; then
    log "  MCP23017 overlay already configured"
    return 0
  fi
  existing="$(grep -E '^[[:space:]]*dtoverlay=mcp23017' "$config_file" | head -n 1 || true)"
  if [ -n "$existing" ]; then
    warn_mcp23017 "Existing MCP23017 overlay line left unchanged: ${existing}"
    return 0
  fi
  config_file_backup "$config_file"
  sudo tee -a "$config_file" > /dev/null <<EOF

${MCP23017_BOOT_MARKER}
[all]
dtparam=i2c_arm=on
dtoverlay=mcp23017,addr=${address},noints,i2c${bus}
EOF
  log "  Added the MCP23017 overlay for ${address} on I2C bus ${bus}"
}

_mcp23017_enable_i2c_dev() {
  if [ -d /etc/modules-load.d ]; then
    echo "i2c-dev" | sudo tee /etc/modules-load.d/i2c-dev.conf > /dev/null
  elif ! grep -qx "i2c-dev" /etc/modules 2>/dev/null; then
    echo "i2c-dev" | sudo tee -a /etc/modules > /dev/null
  fi
}

_mcp23017_add_user_to_groups() {
  local user="${CURRENT_USER:-$(whoami)}"
  sudo groupadd -f i2c
  sudo groupadd -f gpio
  sudo usermod -aG i2c,gpio "$user"
  log "  Added '${user}' to the groups i2c and gpio (takes effect after a new login)"
}

_mcp23017_install_settings() {
  local example="${INSTALLATION_PATH}/resources/default-settings/mcp23017.example.yaml"
  local device_file="${SETTINGS_PATH}/mcp23017.yaml"
  local main_file="${SETTINGS_PATH}/jukebox.yaml"
  local python="${VIRTUAL_ENV}/bin/python"

  if [ ! -x "$python" ]; then
    exit_on_error "ERROR: Python interpreter not found: ${python}"
  fi
  if [ ! -f "$device_file" ]; then
    cp "$example" "$device_file"
    log "  Created ${device_file} from the example"
  else
    log "  Keeping the existing ${device_file}"
  fi
  sudo chown "${CURRENT_USER}:${CURRENT_USER_GROUP}" "$device_file" "$main_file"
  "$python" "${INSTALLATION_PATH}/installation/helpers/mcp23017_settings.py" \
    device "$device_file" "${MCP23017_I2C_BUS}" "${MCP23017_ADDRESS}" \
    || exit_on_error "ERROR: Updating ${device_file} failed."
  "$python" "${INSTALLATION_PATH}/installation/helpers/mcp23017_settings.py" \
    module "$main_file" \
    || exit_on_error "ERROR: Enabling mcp23017 in ${main_file} failed."
  verify_files_chown "${CURRENT_USER}" "${CURRENT_USER_GROUP}" "$device_file" "$main_file"
}

_mcp23017_check_hardware() {
  local bus="${MCP23017_I2C_BUS:-1}"
  local address="${MCP23017_ADDRESS:-0x20}"

  if [ ! -e "/dev/i2c-${bus}" ]; then
    warn_mcp23017 "/dev/i2c-${bus} does not exist yet; a reboot is required."
    return 0
  fi
  if command -v i2cdetect > /dev/null 2>&1; then
    if i2cdetect -y "$bus" 2>/dev/null | grep -qiE "UU|${address#0x}"; then
      log "  MCP23017 detected at ${address} on I2C bus ${bus}"
    else
      warn_mcp23017 "No MCP23017 at ${address} on I2C bus ${bus}; check the jumpers."
    fi
  fi
  if ! i2cget -f -y "$bus" "$address" 0x0c > /dev/null 2>&1; then
    warn_mcp23017 "GPPU is not readable; check the address, bus and permissions."
  fi
  if command -v gpioinfo > /dev/null 2>&1 && ! gpioinfo 2>/dev/null | grep -q '16 lines'; then
    warn_mcp23017 "No gpiochip with 16 lines found; check the overlay and reboot."
  fi
}

_mcp23017_add_fin_message() {
  local message="MCP23017 buttons: reboot required to activate I2C and the overlay."
  FIN_MESSAGE="${FIN_MESSAGE:+$FIN_MESSAGE\n}${message}"
}
