#!/usr/bin/env bash
# Read plugin_registry.yaml and print "name|description" pairs.
# Skips commented-out lines (lines starting with #).
# Usage: source'd or run directly with <path-to-plugin_registry.yaml>

REGISTRY_FILE="${1:-}"

if [[ ! -f "$REGISTRY_FILE" ]]; then
    # Return if sourced (source context), exit if run directly
    return 0 2>/dev/null || exit 0
fi

# Parse YAML: extract name and description from non-commented lines.
# Produces "name|description" output for each plugin entry.
awk '
BEGIN { name = ""; desc = "" }
# Skip commented lines
/^[[:space:]]*#/ { next }
# Match "  - name: plugin_name"
/^[[:space:]]+- name:[[:space:]]/ {
    sub(/^[[:space:]]+- name:[[:space:]]*/, "", $0)
    name = $0
    gsub(/"/, "", name)
}
# Match "    description: ..." immediately after name
/^[[:space:]]+description:[[:space:]]/ {
    if (name != "") {
        sub(/^[[:space:]]+description:[[:space:]]*"?/, "", $0)
        sub(/"?[[:space:]]*$/, "", $0)
        desc = $0
        print name "|" desc
        name = ""
        desc = ""
    }
}
' "$REGISTRY_FILE"