import os
import subprocess
from pathlib import Path


ROOT = Path(__file__).parents[2]
DEFAULTS = ROOT / 'installation' / 'includes' / '01_default_config.sh'
OPTIONS = ROOT / 'installation' / 'routines' / 'customize_options.sh'
DEFAULT_REDIRECT_URI = (
    'http://127.0.0.1:3000/api/v1/spotify/oauth/callback'
)


def _run_spotify_options(user_input, redirect_uri=None):
    harness = r'''
DEFAULTS_PATH="$1"
OPTIONS_PATH="$2"

clear_c() {
    :
}

print_c() {
    :
}

log() {
    :
}

source "${DEFAULTS_PATH}"
source "${OPTIONS_PATH}"
_option_spotify
printf '%s\n' "${SPOTIFY_REDIRECT_URI}"
'''
    env = os.environ.copy()
    if redirect_uri is not None:
        env['SPOTIFY_REDIRECT_URI'] = redirect_uri
    else:
        env.pop('SPOTIFY_REDIRECT_URI', None)

    return subprocess.run(
        [
            'bash',
            '-c',
            harness,
            'test-spotify-options',
            str(DEFAULTS),
            str(OPTIONS),
        ],
        input=user_input,
        check=False,
        capture_output=True,
        env=env,
        text=True,
    )


def test_spotify_options_use_standard_redirect_uri_by_default():
    result = _run_spotify_options('y\nclient-id\n\n\n')

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == DEFAULT_REDIRECT_URI


def test_spotify_options_accept_custom_redirect_uri():
    redirect_uri = 'https://phoniebox.example/api/v1/spotify/oauth/callback'
    result = _run_spotify_options(f'y\nclient-id\n{redirect_uri}\n\n')

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == redirect_uri


def test_spotify_options_preserve_preconfigured_redirect_uri():
    redirect_uri = 'https://configured.example/api/v1/spotify/oauth/callback'
    result = _run_spotify_options(
        'y\nclient-id\n\n',
        redirect_uri=redirect_uri,
    )

    assert result.returncode == 0, result.stderr
    assert result.stdout.strip() == redirect_uri
