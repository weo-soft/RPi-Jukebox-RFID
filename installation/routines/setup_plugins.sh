#!/usr/bin/env bash

# ---------------------------------------------------------------------------
# Generic, data-driven plugin setup routine.
#
# Reads the plugin registry from resources/default-settings/plugin_registry.yaml
# and installs all plugins the user opted in for during customization.
#
# This routine is TYPE-AGNOSTIC — it treats every plugin the same,
# regardless of whether it is a MediaProvider, RFID reader, etc.
# ---------------------------------------------------------------------------

PLUGIN_REGISTRY="${INSTALLATION_PATH}/resources/default-settings/plugin_registry.yaml"

# Set in customize_options.sh by _option_plugins()
# SELECTED_PLUGINS=""
# CUSTOM_PLUGINS=""

# ---------------------------------------------------------------------------
# SINGLE PLUGIN INSTALLATION
# ---------------------------------------------------------------------------

_setup_single_plugin() {
    local plugin_name="$1"
    local plugin_repo="$2"
    local plugin_dir="${INSTALLATION_PATH}/src/jukebox/components/${plugin_name}"

    log "  Installing plugin: ${plugin_name}"

    # 1) Clone plugin repository
    if [[ ! -d "$plugin_dir" ]]; then
        print_c "    Cloning ${plugin_name} from ${plugin_repo}..."
        git clone "$plugin_repo" "$plugin_dir" || {
            print_c "    WARNING: Failed to clone ${plugin_name} from ${plugin_repo}"
            return 1
        }
    else
        log "    Plugin directory already exists: ${plugin_dir}. Skipping clone."
    fi

    # 2) Install plugin-specific system dependencies (if present)
    local deps_script="${plugin_dir}/install_dependencies.sh"
    if [[ -f "$deps_script" ]]; then
        print_c "    Running plugin dependency installer..."
        bash "$deps_script" || {
            print_c "    WARNING: Dependency installation for ${plugin_name} failed."
        }
    fi

    # 3) Install plugin-specific pip requirements (if present)
    local pip_reqs="${plugin_dir}/requirements.txt"
    if [[ -f "$pip_reqs" ]]; then
        print_c "    Installing Python requirements for ${plugin_name}..."
        source "${VIRTUAL_ENV}/bin/activate"
        pip install --no-cache-dir -r "$pip_reqs" || {
            print_c "    WARNING: pip install failed for ${plugin_name}."
        }
    fi

    # 4) Run post-install configuration script (if present)
    # If stdin is a terminal, delegate to the plugin script with terminal input.
    # Otherwise, provide empty input so the script uses its defaults without hanging.
    local configure_script="${plugin_dir}/configure.sh"
    if [[ -f "$configure_script" ]]; then
        print_c "    Running post-install configuration for ${plugin_name}..."
        if [ -t 0 ]; then
            bash "$configure_script" "$plugin_name" || {
                print_c "    WARNING: Configuration for ${plugin_name} failed."
                print_c "    You can re-run it later: bash ${configure_script}"
            }
        else
            # Provide empty responses via pipe so read prompts return immediately,
            # allowing the script to apply its defaults and continue.
            echo "" | bash "$configure_script" "$plugin_name" || {
                print_c "    WARNING: Configuration for ${plugin_name} failed."
                print_c "    You can re-run it later: bash ${configure_script}"
            }
        fi
    fi
}

# ---------------------------------------------------------------------------
# CONFIG ENABLEMENT: Add plugin names to modules.others
# ---------------------------------------------------------------------------

_enable_plugins_in_config() {
    local config_file="${SETTINGS_PATH}/jukebox.yaml"

    if [[ -z "$SELECTED_PLUGINS" ]]; then
        log "No plugins selected. Skipping modules.others config."
        return
    fi

    print_c "  Enabling plugins in jukebox.yaml modules.others:"

    "$VIRTUAL_ENV/bin/python3" -c "
from ruamel.yaml import YAML
yaml = YAML()
yaml.preserve_quotes = True

selected = '${SELECTED_PLUGINS}'.split()
if not selected:
    exit(0)

with open('${config_file}', 'r') as f:
    data = yaml.load(f)

if 'modules' not in data:
    data['modules'] = {}
if 'others' not in data['modules']:
    data['modules']['others'] = []

others = data['modules']['others']
added = []
for plugin in selected:
    if plugin not in others:
        others.append(plugin)
        added.append(plugin)

if added:
    with open('${config_file}', 'w') as f:
        yaml.dump(data, f)

for p in added:
    print(f'    \u2192 {p}')
"
}

# ---------------------------------------------------------------------------
# MAIN ROUTINE
# ---------------------------------------------------------------------------

_run_setup_plugins() {
    local registry_file="$PLUGIN_REGISTRY"

    if [[ ! -f "$registry_file" ]]; then
        log "Plugin registry not found: ${registry_file}. Skipping."
        return
    fi

    # Registry-based plugins
    for selected in $SELECTED_PLUGINS; do
        local repo_url
        repo_url=$("$VIRTUAL_ENV/bin/python3" -c "
from ruamel.yaml import YAML
yaml = YAML()
with open('${registry_file}', 'r') as f:
    data = yaml.load(f)
for p in data.get('plugins', []):
    if p.get('name') == '${selected}':
        print(p.get('repository', ''))
        break
")
        if [[ -z "$repo_url" ]]; then
            print_c "  WARNING: No repository URL for '${selected}'. Skipping."
            continue
        fi

        _setup_single_plugin "$selected" "$repo_url"
    done

    # Custom/user-provided plugins (no registry lookup needed)
    for custom_entry in $CUSTOM_PLUGINS; do
        local custom_name="${custom_entry%%|*}"
        local custom_repo="${custom_entry##*|}"
        if [[ -n "$custom_name" && -n "$custom_repo" ]]; then
            _setup_single_plugin "$custom_name" "$custom_repo"
            # Also add custom plugin names to SELECTED_PLUGINS for config
            if [[ -z "$SELECTED_PLUGINS" ]]; then
                SELECTED_PLUGINS="$custom_name"
            else
                SELECTED_PLUGINS="$SELECTED_PLUGINS $custom_name"
            fi
        fi
    done

    _enable_plugins_in_config
}

setup_plugins() {
    if [[ -n "$SELECTED_PLUGINS" || -n "$CUSTOM_PLUGINS" ]]; then
        run_with_log_frame _run_setup_plugins "Install Plugins"
    else
        log "No plugins selected. Skipping."
    fi
}