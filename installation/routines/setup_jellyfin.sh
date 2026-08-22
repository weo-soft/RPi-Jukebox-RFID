#!/usr/bin/env bash

JELLYFIN_SETTINGS_FILE="${SETTINGS_PATH}/jukebox.yaml"

_jellyfin_set_user_config() {
  print_lc "  Configure Jellyfin"
  print_lc "    Enter your Jellyfin server URL (e.g. http://jellyfin.local:8096):"
  read -r JELLYFIN_HOST
  print_lc "    Enter your Jellyfin API key (Dashboard -> API Keys):"
  read -r JELLYFIN_API_KEY

  if [[ -z "$JELLYFIN_HOST" || -z "$JELLYFIN_API_KEY" ]]; then
    print_c "  WARNING: Jellyfin server URL and API key are required. Skipping Jellyfin setup."
    ENABLE_JELLYFIN=false
    return
  fi

  # The Python heredoc reads the values from the environment, never from shell
  # interpolation, so special characters in host/key are preserved. The
  # delimiter is quoted to prevent any shell expansion inside the Python code.
  JELLYFIN_HOST="$JELLYFIN_HOST" JELLYFIN_API_KEY="$JELLYFIN_API_KEY" \
  JELLYFIN_SETTINGS_FILE="$JELLYFIN_SETTINGS_FILE" \
  "$VIRTUAL_ENV/bin/python3" - << 'PYEOF'
from ruamel.yaml import YAML
import os

yaml = YAML()
yaml.preserve_quotes = True
settings_file = os.environ['JELLYFIN_SETTINGS_FILE']
with open(settings_file, 'r') as stream:
    data = yaml.load(stream) or {}
data.setdefault('players', {})
data['players'].setdefault('jellyfin', {})
data['players']['jellyfin'] = {
    'enabled': True,
    'host': os.environ['JELLYFIN_HOST'],
    'api_key': os.environ['JELLYFIN_API_KEY'],
}
with open(settings_file, 'w') as stream:
    yaml.dump(data, stream)
PYEOF
  if [ $? -ne 0 ]; then
    print_c "  WARNING: Failed to write jellyfin config to ${JELLYFIN_SETTINGS_FILE}."
    ENABLE_JELLYFIN=false
  fi
}

_jellyfin_check() {
  print_verify_installation
  echo "  [Jellyfin] Phoniebox Jellyfin plugin will be activated on next boot."
}

setup_jellyfin() {
  if [[ "$ENABLE_JELLYFIN" == true ]]; then
    run_with_log_frame _jellyfin_set_user_config "Setup Jellyfin"
    _jellyfin_check
  else
    log "Jellyfin setup skipped."
  fi
}
