"""
Tests for jukebox.secrets module.

Covers:
- store() / retrieve() round-trip
- Env variable override
- Key-existence checks (falsy values are valid)
- Empty env variable falls through
- delete() + list_keys() (NO values exposed)
- Cache persistence via _reload_cache()
"""

import os
import sys
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

# Ensure the src/jukebox directory is on sys.path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'src' / 'jukebox'))

import jukebox.secrets as secrets
import jukebox.cfghandler


@pytest.fixture(autouse=True)
def reset_secrets_cache():
    """Reset the secrets module cache before each test."""
    secrets._cache = {}
    secrets._cache_loaded = False
    yield
    secrets._cache = {}
    secrets._cache_loaded = False


@pytest.fixture
def temp_secrets_file(monkeypatch):
    """Create a temporary secrets.yaml and point the config to it."""
    # Create a temporary directory for the secrets file
    tmp_dir = Path(tempfile.mkdtemp())
    secrets_file = tmp_dir / 'secrets.yaml'

    # Mock the config handler to return our temp path
    cfg = jukebox.cfghandler.get_handler('jukebox')
    cfg.setn('secrets', 'file', value=str(secrets_file))

    yield secrets_file

    # Cleanup
    if secrets_file.exists():
        secrets_file.unlink()
    tmp_dir.rmdir()


class TestSecretsStoreRetrieve:
    """Tests for store() and retrieve() round-trip."""

    def test_store_retrieve_roundtrip(self, temp_secrets_file):
        """store() then retrieve() returns the stored value."""
        secrets.store('testns', 'key1', 'value1')
        assert secrets.retrieve('testns', 'key1') == 'value1'

    def test_store_multiple_namespaces(self, temp_secrets_file):
        """store() with different namespaces keeps them separate."""
        secrets.store('ns1', 'key', 'value1')
        secrets.store('ns2', 'key', 'value2')
        assert secrets.retrieve('ns1', 'key') == 'value1'
        assert secrets.retrieve('ns2', 'key') == 'value2'

    def test_store_overwrites_existing(self, temp_secrets_file):
        """store() overwrites an existing value."""
        secrets.store('testns', 'key1', 'original')
        secrets.store('testns', 'key1', 'updated')
        assert secrets.retrieve('testns', 'key1') == 'updated'

    def test_retrieve_env_var_wins(self, temp_secrets_file):
        """retrieve() with env_var set returns the env var value."""
        secrets.store('testns', 'key1', 'yaml_value')
        with patch.dict(os.environ, {'TEST_SECRET': 'env_value'}):
            result = secrets.retrieve('testns', 'key1', env_var='TEST_SECRET')
            assert result == 'env_value'

    def test_retrieve_no_env_falls_to_yaml(self, temp_secrets_file):
        """retrieve() without env_var falls back to YAML."""
        secrets.store('testns', 'key1', 'yaml_value')
        result = secrets.retrieve('testns', 'key1')
        assert result == 'yaml_value'

    def test_retrieve_no_env_no_yaml_returns_default(self, temp_secrets_file):
        """retrieve() without env or YAML returns the default."""
        result = secrets.retrieve('testns', 'nonexistent', default='my_default')
        assert result == 'my_default'

    def test_retrieve_no_env_no_yaml_no_default_returns_none(self, temp_secrets_file):
        """retrieve() without env, YAML, or default returns None."""
        result = secrets.retrieve('testns', 'nonexistent')
        assert result is None


class TestSecretsFalsyValues:
    """Tests that falsy values are valid secrets."""

    def test_empty_string_is_valid(self, temp_secrets_file):
        """An empty string stored as a secret is returned as-is."""
        secrets.store('testns', 'key1', '')
        result = secrets.retrieve('testns', 'key1')
        assert result == ''

    def test_zero_is_valid(self, temp_secrets_file):
        """The value '0' is a valid secret."""
        secrets.store('testns', 'key1', '0')
        result = secrets.retrieve('testns', 'key1')
        assert result == '0'

    def test_false_string_is_valid(self, temp_secrets_file):
        """The value 'False' is a valid secret."""
        secrets.store('testns', 'key1', 'False')
        result = secrets.retrieve('testns', 'key1')
        assert result == 'False'

    def test_empty_env_var_falls_through(self, temp_secrets_file):
        """An environment variable set to empty string falls through to YAML."""
        secrets.store('testns', 'key1', 'yaml_value')
        with patch.dict(os.environ, {'TEST_SECRET': ''}):
            result = secrets.retrieve('testns', 'key1', env_var='TEST_SECRET')
            assert result == 'yaml_value'


class TestSecretsDelete:
    """Tests for delete()."""

    def test_delete_existing_key(self, temp_secrets_file):
        """delete() returns True and removes the key."""
        secrets.store('testns', 'key1', 'value1')
        assert secrets.retrieve('testns', 'key1') == 'value1'
        assert secrets.delete('testns', 'key1') is True
        assert secrets.retrieve('testns', 'key1') is None

    def test_delete_nonexistent_key(self, temp_secrets_file):
        """delete() returns False for a key that doesn't exist."""
        assert secrets.delete('testns', 'nonexistent') is False

    def test_delete_last_key_removes_namespace(self, temp_secrets_file):
        """Deleting the last key in a namespace removes the namespace."""
        secrets.store('testns', 'only_key', 'value')
        secrets.delete('testns', 'only_key')
        # Accessing the namespace directly should return empty/None
        assert secrets.list_keys('testns') == []


class TestSecretsListKeys:
    """Tests for list_keys()."""

    def test_list_keys_returns_only_key_names(self, temp_secrets_file):
        """list_keys() returns only the key names, NOT values."""
        secrets.store('testns', 'key1', 'secret_value_1')
        secrets.store('testns', 'key2', 'secret_value_2')
        keys = secrets.list_keys('testns')
        assert keys == ['key1', 'key2']

    def test_list_keys_empty_namespace(self, temp_secrets_file):
        """list_keys() returns an empty list for an empty namespace."""
        assert secrets.list_keys('nonexistent') == []


class TestSecretsCache:
    """Tests for cache persistence."""

    def test_cache_persistence(self, temp_secrets_file):
        """Values survive a cache reload."""
        secrets.store('testns', 'key1', 'persistent_value')
        secrets._reload_cache()
        assert secrets.retrieve('testns', 'key1') == 'persistent_value'