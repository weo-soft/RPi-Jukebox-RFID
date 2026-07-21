"""
Tests for plugin configuration RPC endpoints (M11).

Tests get_plugin_schemas, get_plugin_configs, set_plugin_config,
and set_plugin_secret functions from jukebox.components.misc.
"""
import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch, MagicMock

import pytest
from ruamel.yaml import YAML


# Import the functions under test
from components import misc


class TestGetPluginSchemas:
    """Tests for get_plugin_schemas()."""

    def test_empty_when_no_plugins_have_schema(self):
        """Returns empty list when no loaded plugins have config_schema.yaml."""
        mock_packages = {
            'player': 'components.playermpd',
            'volume': 'components.volume',
        }
        with patch.object(misc.plugin, 'get_all_loaded_packages',
                          return_value=mock_packages):
            # All modules exist but none have config_schema.yaml
            result = misc.get_plugin_schemas()
            assert result == []

    def test_finds_and_parses_schema_file(self):
        """Finds and parses a valid config_schema.yaml."""
        # Create a temp schema file
        with tempfile.TemporaryDirectory() as tmpdir:
            schema_file = Path(tmpdir) / 'config_schema.yaml'
            schema_content = {
                'config_key': 'test_plugin',
                'display_name': 'Test Plugin',
                'fields': [
                    {'key': 'host', 'type': 'string', 'label': 'Host'},
                    {'key': 'api_key', 'type': 'string', 'label': 'API Key',
                     'sensitive': True},
                ],
            }
            yaml = YAML()
            with open(schema_file, 'w') as f:
                yaml.dump(schema_content, f)

            # Create a mock module that points to the temp dir
            mock_mod = MagicMock()
            mock_mod.__file__ = str(Path(tmpdir) / '__init__.py')

            mock_packages = {'test_plugin': 'components.test_plugin'}
            with patch.object(misc.plugin, 'get_all_loaded_packages',
                              return_value=mock_packages):
                with patch.dict(sys.modules,
                                {'components.test_plugin': mock_mod}):
                    result = misc.get_plugin_schemas()
                    assert len(result) == 1
                    assert result[0]['config_key'] == 'test_plugin'
                    assert result[0]['display_name'] == 'Test Plugin'
                    assert result[0]['_plugin_name'] == 'test_plugin'

    def test_handles_invalid_yaml_gracefully(self):
        """Invalid YAML logs warning but does not crash."""
        with tempfile.TemporaryDirectory() as tmpdir:
            schema_file = Path(tmpdir) / 'config_schema.yaml'
            schema_file.write_text('invalid: [yaml: broken')

            mock_mod = MagicMock()
            mock_mod.__file__ = str(Path(tmpdir) / '__init__.py')

            mock_packages = {'broken': 'components.broken'}
            with patch.object(misc.plugin, 'get_all_loaded_packages',
                              return_value=mock_packages):
                with patch.dict(sys.modules,
                                {'components.broken': mock_mod}):
                    with patch.object(misc.logger, 'warning') as mock_warn:
                        result = misc.get_plugin_schemas()
                        assert result == []
                        mock_warn.assert_called_once()

    def test_skips_plugins_without_file_attribute(self):
        """Skips modules without __file__ attribute."""
        mock_mod = MagicMock(spec=[])
        mock_packages = {'no_file': 'components.no_file'}
        with patch.object(misc.plugin, 'get_all_loaded_packages',
                          return_value=mock_packages):
            with patch.dict(sys.modules,
                            {'components.no_file': mock_mod}):
                result = misc.get_plugin_schemas()
                assert result == []


class TestGetPluginConfigs:
    """Tests for get_plugin_configs()."""

    def test_reads_values_from_jukebox_yaml(self):
        """Non-sensitive values are read from jukebox.yaml."""
        schema = {
            'config_key': 'test_plugin',
            'fields': [
                {'key': 'host', 'type': 'string', 'label': 'Host',
                 'default': ''},
                {'key': 'port', 'type': 'integer', 'label': 'Port',
                 'default': 8096},
            ],
        }
        with patch.object(misc, 'get_plugin_schemas',
                          return_value=[schema]):
            with patch.object(misc.cfg, 'getn') as mock_getn:
                mock_getn.side_effect = lambda *keys, default: (
                    'http://localhost' if keys[1] == 'host' else 8096
                )
                result = misc.get_plugin_configs()
                assert 'test_plugin' in result
                assert result['test_plugin']['host'] == 'http://localhost'
                assert result['test_plugin']['port'] == 8096

    def test_masks_sensitive_values(self):
        """Sensitive values are masked as '***'."""
        schema = {
            'config_key': 'test_plugin',
            'fields': [
                {'key': 'api_key', 'type': 'string', 'label': 'API Key',
                 'sensitive': True},
            ],
        }
        with patch.object(misc, 'get_plugin_schemas',
                          return_value=[schema]):
            with patch.object(misc, 'retrieve',
                              return_value='secret123'):
                result = misc.get_plugin_configs()
                assert result['test_plugin']['api_key'] == '***'

    def test_returns_empty_for_unset_sensitive_value(self):
        """Unset sensitive fields return empty string, not '***'."""
        schema = {
            'config_key': 'test_plugin',
            'fields': [
                {'key': 'api_key', 'type': 'string', 'label': 'API Key',
                 'sensitive': True},
            ],
        }
        with patch.object(misc, 'get_plugin_schemas',
                          return_value=[schema]):
            with patch.object(misc, 'retrieve',
                              return_value=None):
                result = misc.get_plugin_configs()
                assert result['test_plugin']['api_key'] == ''

    def test_returns_default_for_unconfigured_fields(self):
        """Returns field default when not present in config."""
        schema = {
            'config_key': 'test_plugin',
            'fields': [
                {'key': 'host', 'type': 'string', 'label': 'Host',
                 'default': 'http://default'},
            ],
        }
        with patch.object(misc, 'get_plugin_schemas',
                          return_value=[schema]):
            with patch.object(misc.cfg, 'getn',
                              return_value='http://default'):
                result = misc.get_plugin_configs()
                assert result['test_plugin']['host'] == 'http://default'


class TestSetPluginConfig:
    """Tests for set_plugin_config()."""

    def test_writes_non_sensitive_fields(self):
        """Non-sensitive fields are written via cfg.setn()."""
        schema = {
            'config_key': 'test_plugin',
            'fields': [
                {'key': 'host', 'type': 'string', 'label': 'Host'},
                {'key': 'port', 'type': 'integer', 'label': 'Port'},
            ],
        }
        with patch.object(misc, 'get_plugin_schemas',
                          return_value=[schema]):
            with patch.object(misc.cfg, 'setn') as mock_setn:
                result = misc.set_plugin_config(
                    'test_plugin',
                    {'host': 'http://new', 'port': 1234}
                )
                assert result['success'] is True
                assert mock_setn.call_count == 2

    def test_skips_sensitive_fields(self):
        """Sensitive fields are NOT written to jukebox.yaml."""
        schema = {
            'config_key': 'test_plugin',
            'fields': [
                {'key': 'host', 'type': 'string', 'label': 'Host'},
                {'key': 'api_key', 'type': 'string', 'label': 'API Key',
                 'sensitive': True},
            ],
        }
        with patch.object(misc, 'get_plugin_schemas',
                          return_value=[schema]):
            with patch.object(misc.cfg, 'setn') as mock_setn:
                result = misc.set_plugin_config(
                    'test_plugin',
                    {'host': 'http://new', 'api_key': 'secret'}
                )
                assert result['success'] is True
                # Only 'host' should be written
                mock_setn.assert_called_once_with(
                    'test_plugin', 'host', value='http://new'
                )

    def test_returns_errors_on_write_failure(self):
        """Returns success: False with errors when cfg.setn() fails."""
        schema = {
            'config_key': 'test_plugin',
            'fields': [
                {'key': 'host', 'type': 'string', 'label': 'Host'},
            ],
        }
        with patch.object(misc, 'get_plugin_schemas',
                          return_value=[schema]):
            with patch.object(misc.cfg, 'setn',
                              side_effect=Exception('disk full')):
                result = misc.set_plugin_config(
                    'test_plugin',
                    {'host': 'http://new'}
                )
                assert result['success'] is False
                assert len(result['errors']) == 1

    def test_no_schema_no_errors(self):
        """When plugin has no schema, all fields are treated as writeable."""
        with patch.object(misc, 'get_plugin_schemas',
                          return_value=[]):
            with patch.object(misc.cfg, 'setn') as mock_setn:
                result = misc.set_plugin_config(
                    'unknown',
                    {'some_key': 'some_value'}
                )
                assert result['success'] is True
                mock_setn.assert_called_once()


class TestSetPluginSecret:
    """Tests for set_plugin_secret()."""

    def test_writes_via_secrets_store(self):
        """Secret is stored via jukebox.secrets.store()."""
        with patch.object(misc, 'secrets_store') as mock_store:
            result = misc.set_plugin_secret(
                'test_plugin', 'api_key', 'my-secret'
            )
            assert result['success'] is True
            mock_store.assert_called_once_with(
                'test_plugin', 'api_key', 'my-secret'
            )

    def test_skips_masked_placeholder(self):
        """When value is '***', the write is skipped."""
        with patch.object(misc, 'secrets_store') as mock_store:
            result = misc.set_plugin_secret(
                'test_plugin', 'api_key', '***'
            )
            assert result['success'] is True
            assert 'Secret unchanged' in result['message']
            mock_store.assert_not_called()

    def test_handles_store_error(self):
        """Returns error when secrets_store() raises."""
        with patch.object(misc, 'secrets_store',
                          side_effect=Exception('permission denied')):
            result = misc.set_plugin_secret(
                'test_plugin', 'api_key', 'my-secret'
            )
            assert result['success'] is False
            assert 'error' in result

    def test_empty_value_clears_secret(self):
        """Empty string is passed through to secrets_store (clearing)."""
        with patch.object(misc, 'secrets_store') as mock_store:
            result = misc.set_plugin_secret(
                'test_plugin', 'api_key', ''
            )
            assert result['success'] is True
            mock_store.assert_called_once_with(
                'test_plugin', 'api_key', ''
            )