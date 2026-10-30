"""Tests for the MCP23017 installer option."""

import os
import subprocess

REPOSITORY_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def run_shell(script):
    result = subprocess.run(['bash', '-c', script], cwd=REPOSITORY_ROOT,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert 'ok' in result.stdout


def test_option_reads_address_and_bus():
    run_shell("""
        set -e
        source installation/includes/01_default_config.sh
        clear_c() { :; }
        print_c() { :; }
        log() { :; }
        source installation/routines/customize_options.sh
        _option_mcp23017 <<< $'y\\n0x99\\n0x21\\n9\\n2'
        [ "$ENABLE_MCP23017" = true ]
        [ "$MCP23017_ADDRESS" = "0x21" ]
        [ "$MCP23017_I2C_BUS" = "2" ]
        _option_mcp23017 <<< 'n'
        [ "$ENABLE_MCP23017" = false ]
        echo ok
    """)


def test_option_defaults():
    run_shell("""
        set -e
        source installation/includes/01_default_config.sh
        clear_c() { :; }
        print_c() { :; }
        log() { :; }
        source installation/routines/customize_options.sh
        _option_mcp23017 <<< $'y\\n\\n\\n'
        [ "$ENABLE_MCP23017" = true ]
        [ "$MCP23017_ADDRESS" = "0x20" ]
        [ "$MCP23017_I2C_BUS" = "1" ]
        echo ok
    """)
