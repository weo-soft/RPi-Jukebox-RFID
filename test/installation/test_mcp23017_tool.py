"""Tests for the MCP23017 diagnostics tool."""

import os
import subprocess
import sys

REPOSITORY_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE_ROOT = os.path.join(REPOSITORY_ROOT, 'src', 'jukebox')
TOOL = os.path.join(SOURCE_ROOT, 'run_configure_mcp23017_buttons.py')
EXAMPLE = os.path.join(REPOSITORY_ROOT, 'resources', 'default-settings',
                       'mcp23017.example.yaml')


def run_tool(*arguments):
    return subprocess.run([sys.executable, TOOL, *arguments], cwd=SOURCE_ROOT,
                          capture_output=True, text=True)


def test_validate_example_configuration():
    result = run_tool('--validate', '--config', EXAMPLE)
    assert result.returncode == 0, result.stdout + result.stderr
    assert 'play_pause' in result.stdout
    assert '5 valid' in result.stdout


def test_validate_reports_invalid_configuration(tmp_path):
    path = tmp_path / 'mcp23017.yaml'
    path.write_text('bus: 9\naddress: 0x20\nbuttons: {}\n', encoding='utf-8')
    result = run_tool('--validate', '--config', str(path))
    assert result.returncode == 1
    assert 'ERROR' in result.stdout


def test_generate_config_requires_force(tmp_path):
    target = tmp_path / 'settings' / 'mcp23017.yaml'
    result = run_tool('--generate-config', '--config', str(target))
    assert result.returncode == 0, result.stderr
    assert target.is_file()
    result = run_tool('--generate-config', '--config', str(target))
    assert result.returncode == 1
    result = run_tool('--generate-config', '--config', str(target), '--force')
    assert result.returncode == 0, result.stderr


def test_test_button_reports_unreachable_server():
    result = run_tool('--test-button', 'play_pause')
    assert result.returncode == 1
    assert 'ERROR' in result.stdout
