"""Plugin loader integration tests for the MCP23017 button support."""

import os
import subprocess
import sys
import textwrap

REPOSITORY_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE_ROOT = os.path.join(REPOSITORY_ROOT, 'src', 'jukebox')


def run_plugin(code):
    result = subprocess.run([sys.executable, '-c', textwrap.dedent(code)], cwd=SOURCE_ROOT,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert 'ok' in result.stdout


def test_disabled_plugin_registers_the_control_object():
    run_plugin("""
        import jukebox.plugs as plugs
        plugs.load('gpio.mcp23017.plugin', load_as='mcp23017', prefix='components')

        status = plugs.call('mcp23017', 'ctrl', 'get_status')
        assert status['state'] == 'disabled', status
        assert status['enabled'] is False, status
        assert status['buttons'] == [], status
        assert status['gppu_mask'] == 0, status

        plugs.close_down(signal_id=0)
        print('ok')
    """)


def test_missing_configuration_file_is_reported_through_the_status():
    run_plugin("""
        import jukebox.cfghandler as cfg
        import jukebox.plugs as plugs

        main = cfg.get_handler('jukebox')
        main.config_dict({'mcp23017': {'enable': True,
                                       'config_file': '/nonexistent/mcp23017.yaml'}})
        plugs.load('gpio.mcp23017.plugin', load_as='mcp23017', prefix='components')

        status = plugs.call('mcp23017', 'ctrl', 'get_status')
        assert status['state'] == 'error', status
        assert status['enabled'] is True, status
        assert 'FileNotFoundError' in (status['last_error'] or ''), status

        buttons = plugs.call('mcp23017', 'ctrl', 'list_buttons')
        assert buttons == [], buttons

        plugs.close_down(signal_id=0)
        print('ok')
    """)
