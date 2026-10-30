#!/usr/bin/env bash

set -euo pipefail

SOURCE="${BASH_SOURCE[0]}"
SCRIPT_DIR="$(dirname "$SOURCE")"
REPOSITORY_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"

source "${REPOSITORY_ROOT}/installation/includes/01_default_config.sh"
source "${REPOSITORY_ROOT}/installation/includes/02_helpers.sh"
source "${REPOSITORY_ROOT}/installation/routines/setup_mcp23017.sh"

log() { :; }
print_c() { :; }
print_lc() { :; }
clear_c() { :; }
sudo() { "$@"; }

ENABLE_MCP23017=true
MCP23017_ADDRESS=0x20
MCP23017_I2C_BUS=1

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

boot="${work}/config.txt"
printf 'dtparam=audio=on\n[pi4]\narm_boost=1\n' > "$boot"

_mcp23017_apply_boot_config "$boot"
grep -qF '# MCP23017 I2C GPIO expander' "$boot"
grep -qF '[all]' "$boot"
grep -qF 'dtparam=i2c_arm=on' "$boot"
grep -qF 'dtoverlay=mcp23017,addr=0x20,noints,i2c1' "$boot"
test -f "${boot}.orig"

first="$(cat "$boot")"
_mcp23017_apply_boot_config "$boot"
[ "$first" = "$(cat "$boot")" ]
[ "$(grep -c 'dtoverlay=mcp23017' "$boot")" -eq 1 ]

other="${work}/other.txt"
printf 'dtoverlay=mcp23017,addr=0x21,noints,i2c1\n' > "$other"
before="$(cat "$other")"
_mcp23017_apply_boot_config "$other" 2>/dev/null
[ "$before" = "$(cat "$other")" ]

missing="${work}/missing.txt"
_mcp23017_apply_boot_config "$missing"

echo "MCP23017 setup tests passed"
