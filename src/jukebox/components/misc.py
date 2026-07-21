"""
Miscellaneous function package
"""
import os
import sys
import time
import logging.handlers
import jukebox
import jukebox.plugs as plugin
import jukebox.utils
from jukebox.daemon import get_jukebox_daemon
import jukebox.cfghandler
from ruamel.yaml import YAML
from jukebox.secrets import retrieve, store as secrets_store

logger = logging.getLogger('jb.misc')
cfg = jukebox.cfghandler.get_handler('jukebox')


@plugin.register
def rpc_cmd_help():
    """Return all commands for RPC"""
    return plugin.summarize()


@plugin.register
def get_all_loaded_packages():
    """Get all successfully loaded plugins"""
    return plugin.get_all_loaded_packages()


@plugin.register
def get_all_failed_packages():
    """Get all plugins with error during load or initialization"""
    return plugin.get_all_failed_packages()


@plugin.register
def get_start_time():
    """Time when JukeBox has been started"""
    return time.ctime(get_jukebox_daemon().start_time)


def get_log(handler_name: str):
    """Get the log file from the loggers (debug_file_handler, error_file_handler)"""
    # With the correct logger.yaml, there is up to two RotatingFileHandler attached
    content = "No file handles configured"
    for h in logging.getLogger('jb').handlers:
        if isinstance(h, logging.handlers.RotatingFileHandler):
            content = f"No file handler with name {handler_name} configured"
            if h.name == handler_name:
                try:
                    size = os.path.getsize(h.baseFilename)
                    if size == 0:
                        content = f"Log file {h.baseFilename} is empty. (Could be good or bad: " \
                                  "Is the RotatingFileHandler configured as handler sink for jb in logger.yaml?)"
                        break
                    mtime = os.path.getmtime(h.baseFilename)
                    stime = get_jukebox_daemon().start_time
                    logger.debug(f"Accessing log file {h.baseFilename} modified time {time.ctime(mtime)} "
                                 f"(JB start time {time.ctime(stime)})")
                    # Generous 3 second tolerance between file creation and jukebox start time recording
                    if mtime - stime < -3:
                        content = (f"Log file {h.baseFilename} too old for this Jukebox start! "
                                   f"Is the RotatingFileHandler configured as handler sink for jb in logger.yaml?")
                        break
                    with open(h.baseFilename) as stream:
                        content = stream.read()
                except Exception as e:
                    content = f"{e.__class__.__name__}: {e}"
                    logger.error(content)
                break
    return content


@plugin.register
def get_log_debug():
    """Get the log file (from the debug_file_handler)"""
    return get_log('debug_file_handler')


@plugin.register
def get_log_error():
    """Get the log file (from the error_file_handler)"""
    return get_log('error_file_handler')


@plugin.register
def get_version():
    return jukebox.version()


@plugin.register
def get_git_state():
    """Return git state information for the current branch"""
    return get_jukebox_daemon().git_state


@plugin.register
def empty_rpc_call(msg: str = ''):
    """This function does nothing.

    The RPC command alias 'none' is mapped to this function.

    This is also used when configuration errors lead to non existing RPC command alias definitions.
    When the alias definition is void, we still want to return a valid function to simplify error handling
    up the module call stack.

    :param msg: If present, this message is send to the logger with severity warning
    """
    if msg:
        logger.warning(msg)


@plugin.register
def get_app_settings():
    """Return settings for web app stored in jukebox.yaml"""
    show_covers = cfg.setndefault('webapp', 'show_covers', value=True)

    return {
        'show_covers': show_covers
    }


@plugin.register
def set_app_settings(settings={}):
    """Set configuration settings for the web app."""
    for key, value in settings.items():
        cfg.setn('webapp', key, value=value)


# --------------------------------------------------------------------------
# Plugin Configuration (M11)
# --------------------------------------------------------------------------

@plugin.register
def get_plugin_schemas():
    """Return config_schema.yaml contents from all loaded plugins.

    Scans each loaded plugin directory for a config_schema.yaml file.
    Parses and validates the schema, returning a list of schema objects.
    Plugins without config_schema.yaml are silently skipped.

    RPC: misc.get_plugin_schemas

    :return: List of schema dicts, each containing:
             - config_key (str): top-level YAML key in jukebox.yaml
             - display_name (str): human-readable plugin name
             - description (str, optional): plugin description
             - fields (list): array of field definitions
    """
    schemas = []
    all_loaded = plugin.get_all_loaded_packages()

    for pkg_name, module_name in all_loaded.items():
        mod = sys.modules.get(module_name)
        if mod is None:
            continue
        try:
            plugin_dir = os.path.dirname(os.path.abspath(mod.__file__))
        except AttributeError:
            continue

        schema_file = os.path.join(plugin_dir, 'config_schema.yaml')
        if not os.path.isfile(schema_file):
            continue

        try:
            yaml = YAML(typ='safe')
            with open(schema_file, 'r') as f:
                schema = yaml.load(f)
            if schema and isinstance(schema, dict):
                schema['_plugin_name'] = pkg_name
                schemas.append(schema)
        except Exception as e:
            logger.warning(
                f"Failed to parse config_schema.yaml for plugin "
                f"'{pkg_name}': {e}"
            )

    return schemas


@plugin.register
def get_plugin_configs():
    """Read all plugin configurations from jukebox.yaml and secrets.yaml.

    For each plugin that has a config_schema.yaml, reads the corresponding
    config values. Non-sensitive values come from jukebox.yaml, sensitive
    values come from secrets.yaml (masked as '***').

    RPC: misc.get_plugin_configs

    :return: Dict keyed by plugin config_key:
             {config_key: {field_key: value, ...}}
    """
    configs = {}
    schemas = get_plugin_schemas()

    for schema in schemas:
        config_key = schema.get('config_key')
        if not config_key:
            continue

        plugin_config = {}

        for field in schema.get('fields', []):
            key = field.get('key')
            if not key:
                continue

            is_sensitive = field.get('sensitive', False)

            if is_sensitive:
                secret_value = retrieve(config_key, key, default=None)
                plugin_config[key] = '***' if secret_value else ''
            else:
                value = cfg.getn(config_key, key,
                                 default=field.get('default', ''))
                plugin_config[key] = value

        configs[config_key] = plugin_config

    return configs


@plugin.register
def set_plugin_config(plugin_name: str, config: dict = {}):
    """Write non-sensitive plugin configuration to jukebox.yaml.

    Iterates over the provided config dict and writes each key/value
    pair under the plugin's top-level config_key in jukebox.yaml.
    Only fields NOT marked as 'sensitive' in the plugin's
    config_schema.yaml are written (sensitive fields are silently
    ignored — use set_plugin_secret for those).

    RPC: misc.set_plugin_config

    :param plugin_name: The plugin's config_key
    :param config: Dict of {field_key: new_value}
    :return: Dict with 'success': True/False and 'errors': [str] if any
    """
    schemas = get_plugin_schemas()
    schema = next(
        (s for s in schemas if s.get('config_key') == plugin_name),
        None
    )

    sensitive_fields = set()
    if schema:
        for field in schema.get('fields', []):
            if field.get('sensitive', False):
                sensitive_fields.add(field.get('key'))

    errors = []
    for key, value in config.items():
        if key in sensitive_fields:
            continue
        try:
            cfg.setn(plugin_name, key, value=value)
        except Exception as e:
            errors.append(f"Failed to write '{key}': {e}")

    if errors:
        return {'success': False, 'errors': errors}
    return {'success': True, 'errors': []}


@plugin.register
def set_plugin_secret(plugin_name: str, key: str, value: str):
    """Write a single sensitive value to secrets.yaml.

    Uses jukebox.secrets.store() to persist the value in secrets.yaml
    (chmod 600). If value is '***' (the masked placeholder), the write
    is skipped — this prevents overwriting actual secrets with the
    masked placeholder.

    RPC: misc.set_plugin_secret

    :param plugin_name: The plugin's config_key (namespace for secrets)
    :param key: The field key
    :param value: The new secret value (or empty string to clear)
    :return: Dict with 'success': True/False
    """
    if value == '***':
        return {'success': True, 'message': 'Secret unchanged (masked value)'}

    try:
        secrets_store(plugin_name, key, value)
        return {'success': True}
    except Exception as e:
        logger.error(f"Failed to store secret '{plugin_name}.{key}': {e}")
        return {'success': False, 'error': str(e)}
