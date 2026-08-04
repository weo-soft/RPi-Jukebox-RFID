import re
from pathlib import Path


ROOT = Path(__file__).parents[2]
SETUP = ROOT / 'installation' / 'routines' / 'setup_spotify.sh'
DOCKERFILE = ROOT / 'docker' / 'Dockerfile.librespot'


def _revision(contents, pattern):
    match = re.search(pattern, contents, flags=re.MULTILINE)
    assert match is not None
    return match.group(1)


def test_installer_and_docker_pin_the_same_librespot_revision():
    setup = SETUP.read_text()
    dockerfile = DOCKERFILE.read_text()

    setup_revision = _revision(
        setup,
        r'^LIBRESPOT_REVISION="([0-9a-f]{40})"$',
    )
    docker_revision = _revision(
        dockerfile,
        r'^ARG LIBRESPOT_REV=([0-9a-f]{40})$',
    )

    assert setup_revision == docker_revision
    assert '--git "${LIBRESPOT_REPOSITORY}"' in setup
    assert '--rev "${LIBRESPOT_REVISION}"' in setup
    assert '--git https://github.com/librespot-org/librespot.git' in dockerfile
    assert '--rev "${LIBRESPOT_REV}"' in dockerfile
