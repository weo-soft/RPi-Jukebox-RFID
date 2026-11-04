# RPi-Jukebox-RFID Version 3
# Copyright (c) See file LICENSE in project root folder
"""
RPC action parsing, resolution and binding for the MCP23017 buttons.

An action is either an RPC alias or a full RPC command. Parsing checks the
shape only; resolution maps an alias to its package, plugin and method, and
binding turns the resolved command into a callable that is cheap to invoke
from the polling thread.
"""

import logging
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Mapping, Optional

import jukebox.plugs as plugin
import jukebox.utils

logger = logging.getLogger('jb.mcp23017')

_ACTION_KEYS = frozenset({'alias', 'package', 'plugin', 'method', 'args', 'kwargs'})


class ActionError(ValueError):
    """Raised when an action cannot be parsed or resolved."""


@dataclass(frozen=True)
class ActionSpec:
    """Action as written in the configuration file."""

    source: str
    alias: Optional[str] = None
    package: Optional[str] = None
    plugin: Optional[str] = None
    method: Optional[str] = None
    args: Optional[List[Any]] = None
    kwargs: Optional[Dict[str, Any]] = None


@dataclass(frozen=True)
class ResolvedAction:
    """Action with package, plugin and method from the RPC alias table."""

    source: str
    package: str
    plugin: str
    method: Optional[str]
    args: List[Any]
    kwargs: Dict[str, Any]

    def to_rpc(self) -> Dict[str, Any]:
        """Return the RPC call dictionary used for binding."""
        return {
            'package': self.package,
            'plugin': self.plugin,
            'method': self.method,
            'args': list(self.args),
            'kwargs': dict(self.kwargs),
        }

    def target(self) -> Dict[str, Any]:
        """Return the JSON-serializable target description."""
        return {
            'package': self.package,
            'plugin': self.plugin,
            'method': self.method,
            'args': list(self.args),
            'kwargs': dict(self.kwargs),
        }


def parse_action(raw: Any) -> ActionSpec:
    """Validate the shape of a configured action and return its specification."""
    if not isinstance(raw, Mapping):
        raise ActionError('action must be a mapping')
    unknown = set(raw) - _ACTION_KEYS
    if unknown:
        keys = ', '.join(sorted(str(key) for key in unknown))
        raise ActionError(f'unknown action key(s): {keys}')
    args = _parse_args(raw.get('args'))
    kwargs = _parse_kwargs(raw.get('kwargs'))
    alias = raw.get('alias')
    if alias is not None:
        if not isinstance(alias, str) or not alias.strip():
            raise ActionError("'alias' must be a non-empty string")
        return ActionSpec(source='alias', alias=alias.strip(), args=args, kwargs=kwargs)
    package = raw.get('package')
    plugin = raw.get('plugin')
    if not _non_empty(package) or not _non_empty(plugin):
        raise ActionError("action needs 'alias' or both 'package' and 'plugin'")
    method = raw.get('method')
    if method is not None and not _non_empty(method):
        raise ActionError("'method' must be a non-empty string or omitted")
    return ActionSpec(source='rpc', package=package, plugin=plugin, method=method,
                      args=args, kwargs=kwargs)


def resolve_action(spec: ActionSpec,
                   known_aliases: Mapping[str, Mapping[str, Any]]) -> ResolvedAction:
    """Resolve an action against the RPC alias table."""
    if spec.source == 'alias':
        if spec.alias not in known_aliases:
            raise ActionError(f"unknown RPC alias '{spec.alias}'")
        command = {'alias': spec.alias}
        if spec.args is not None:
            command['args'] = list(spec.args)
        if spec.kwargs is not None:
            command['kwargs'] = dict(spec.kwargs)
        decoded = jukebox.utils.decode_rpc_command(command, logger=logger)
    else:
        decoded = {
            'package': spec.package,
            'plugin': spec.plugin,
            'method': spec.method,
            'args': spec.args,
            'kwargs': spec.kwargs,
        }
    if not decoded:
        raise ActionError('empty RPC command')
    return ResolvedAction(
        source=spec.source,
        package=decoded['package'],
        plugin=decoded['plugin'],
        method=decoded.get('method'),
        args=list(decoded.get('args') or []),
        kwargs=dict(decoded.get('kwargs') or {}),
    )


class ActionBinder:
    """Bind resolved actions to callables, with all plugin checks applied once."""

    def __init__(self, log: logging.Logger = logger):
        self._logger = log

    def bind(self, action: ResolvedAction) -> Callable[[], Any]:
        """Bind the action and wake the display after it ran."""
        function = jukebox.utils.bind_rpc_command(action.to_rpc(), dereference=True,
                                                  logger=self._logger)

        def bound():
            result = function()
            plugin.call_ignore_errors('display', 'activity')
            return result

        return bound


def _parse_args(value: Any) -> Optional[List[Any]]:
    if value is None:
        return None
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, (str, int, float)):
        return [value]
    raise ActionError("'args' must be a list")


def _parse_kwargs(value: Any) -> Optional[Dict[str, Any]]:
    if value is None:
        return None
    if not isinstance(value, Mapping):
        raise ActionError("'kwargs' must be a mapping")
    return dict(value)


def _non_empty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())
