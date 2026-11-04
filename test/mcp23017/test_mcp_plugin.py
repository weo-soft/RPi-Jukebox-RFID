"""Plugin loader integration tests for the MCP23017 button support."""

import os
import subprocess
import sys
import textwrap

REPOSITORY_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE_ROOT = os.path.join(REPOSITORY_ROOT, 'src', 'jukebox')


def run_plugin(code, env=None):
    result = subprocess.run([sys.executable, '-c', textwrap.dedent(code)], cwd=SOURCE_ROOT,
                            capture_output=True, text=True,
                            env={**os.environ, **(env or {})})
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

        settings = plugs.call('mcp23017', 'ctrl', 'get_button_settings')
        assert settings['state'] == 'disabled', settings
        assert len(settings['actions']) == 8, settings
        assert len(settings['pins']) == 16, settings
        assert all(not pin['assigned'] for pin in settings['pins']), settings

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


def test_settings_surface_is_available_without_hardware(tmp_path):
    config = tmp_path / 'mcp23017.yaml'
    config.write_text("""bus: 1
address: 0x20
poll_interval_ms: 25
buttons:
  play_pause:
    pin: GPA0
    type: momentary
    debounce_ms: 30
    actions:
      on_press:
        alias: toggle
""", encoding='utf-8')
    run_plugin("""
        import os
        import jukebox.cfghandler as cfg
        import jukebox.plugs as plugs
        import components.gpio.mcp23017.device as device

        def fail(*args, **kwargs):
            raise RuntimeError('no hardware in this test')

        device.detect_chip = fail
        main = cfg.get_handler('jukebox')
        main.config_dict({'mcp23017': {'enable': True,
                                       'config_file': os.environ['MCP_TEST_CONFIG']}})
        plugs.load('gpio.mcp23017.plugin', load_as='mcp23017', prefix='components')

        settings = plugs.call('mcp23017', 'ctrl', 'get_button_settings')
        assert settings['state'] == 'error', settings
        assert len(settings['actions']) == 8, settings
        assert len(settings['pins']) == 16, settings
        assert settings['pins'][0]['action_id'] == 'play_pause', settings
        assert settings['pins'][1]['assigned'] is False, settings

        plugs.close_down(signal_id=0)
        print('ok')
    """, env={'MCP_TEST_CONFIG': str(config)})
