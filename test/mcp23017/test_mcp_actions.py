"""Action parsing, resolution and binding tests for the MCP23017 plugin."""

import os
import subprocess
import sys
import textwrap

import pytest

from components.gpio.mcp23017.actions import (
    ActionError,
    ActionSpec,
    parse_action,
    resolve_action,
)
from components.rpc_command_alias import cmd_alias_definitions

REPOSITORY_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SOURCE_ROOT = os.path.join(REPOSITORY_ROOT, 'src', 'jukebox')


def test_parse_alias():
    spec = parse_action({'alias': 'toggle'})
    assert spec.source == 'alias'
    assert spec.alias == 'toggle'
    assert spec.args is None


def test_parse_full_rpc():
    spec = parse_action({'package': 'player', 'plugin': 'ctrl', 'method': 'next'})
    assert spec.source == 'rpc'
    assert spec.package == 'player'
    assert spec.plugin == 'ctrl'
    assert spec.method == 'next'


def test_parse_scalar_args():
    spec = parse_action({'alias': 'change_volume', 'args': 2})
    assert spec.args == [2]


def test_parse_kwargs():
    spec = parse_action({'package': 'player', 'plugin': 'ctrl',
                         'kwargs': {'force': True}})
    assert spec.kwargs == {'force': True}


@pytest.mark.parametrize('raw', [
    'toggle',
    None,
    {'package': 'player'},
    {'plugin': 'ctrl'},
    {'alias': ''},
    {'alias': 5},
    {'package': 'player', 'plugin': 'ctrl', 'args': {'a': 1}},
    {'package': 'player', 'plugin': 'ctrl', 'kwargs': [1]},
    {'alias': 'toggle', 'arg': 1},
])
def test_invalid_actions(raw):
    with pytest.raises(ActionError):
        parse_action(raw)


def test_resolve_alias():
    resolved = resolve_action(parse_action({'alias': 'toggle'}), cmd_alias_definitions)
    assert resolved.source == 'alias'
    assert (resolved.package, resolved.plugin, resolved.method) == ('player', 'ctrl', 'toggle')
    assert resolved.args == []
    assert resolved.kwargs == {}


def test_resolve_alias_with_args_override():
    resolved = resolve_action(parse_action({'alias': 'change_volume', 'args': [2]}),
                              cmd_alias_definitions)
    assert (resolved.package, resolved.plugin, resolved.method) == ('volume', 'ctrl',
                                                                   'change_volume')
    assert resolved.args == [2]


def test_resolve_unknown_alias():
    with pytest.raises(ActionError):
        resolve_action(parse_action({'alias': 'does_not_exist'}), cmd_alias_definitions)


def test_resolve_full_rpc():
    spec = ActionSpec(source='rpc', package='host', plugin='shutdown', method=None)
    resolved = resolve_action(spec, cmd_alias_definitions)
    assert (resolved.package, resolved.plugin, resolved.method) == ('host', 'shutdown', None)
    assert resolved.target() == {
        'package': 'host',
        'plugin': 'shutdown',
        'method': None,
        'args': [],
        'kwargs': {},
    }


def test_binder_wakes_the_display_after_the_action(monkeypatch):
    from components.gpio.mcp23017 import actions

    calls = []
    monkeypatch.setattr(
        actions.jukebox.utils,
        'bind_rpc_command',
        lambda *args, **kwargs: lambda: calls.append('action'),
    )
    monkeypatch.setattr(
        actions.plugin,
        'call_ignore_errors',
        lambda *args, **kwargs: calls.append(('display', 'activity')),
    )
    resolved = resolve_action(
        ActionSpec(source='rpc', package='player', plugin='ctrl',
                   method='toggle'),
        {},
    )

    function = actions.ActionBinder().bind(resolved)
    function()

    assert calls == ['action', ('display', 'activity')]


def test_binder_binds_a_real_plugin_callable():
    code = textwrap.dedent("""
        import jukebox.plugs as plugs
        plugs.load('misc', load_as='misc', prefix='components')

        from components.gpio.mcp23017.actions import (
            ActionBinder, ActionSpec, resolve_action,
        )

        spec = resolve_action(ActionSpec('rpc', package='misc',
                                         plugin='empty_rpc_call',
                                         args=[], kwargs={}), {})
        function = ActionBinder().bind(spec)
        assert function() is None

        bad = resolve_action(ActionSpec('rpc', package='misc',
                                        plugin='does_not_exist',
                                        args=[], kwargs={}), {})
        try:
            ActionBinder().bind(bad)
        except NameError:
            pass
        else:
            raise AssertionError('unknown plugin object must fail at bind time')
        print('ok')
    """)
    result = subprocess.run([sys.executable, '-c', code], cwd=SOURCE_ROOT,
                            capture_output=True, text=True)
    assert result.returncode == 0, result.stderr
    assert 'ok' in result.stdout
