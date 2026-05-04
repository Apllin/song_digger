"""Shared fixtures for smoke + speed tests.

Both suites are opt-in via pytest markers (`-m smoke` / `-m speed`); see
pytest.ini at python-service/ for the marker registration. The default
`pytest` invocation runs neither — they hit live external services and
take significantly longer than unit tests.
"""
import pytest


# Popular techno seeds used across smoke tests. These are well-cataloged
# tracks that should reliably appear in every active source's index. If
# any of these stop returning results, that's a smoke-test signal worth
# investigating (either the seed is no longer popular, or the source is
# broken).
POPULAR_SEEDS: list[tuple[str, str]] = [
    ("Oscar Mulero", "Horses"),
    ("Charlotte de Witte", "Apollo"),
    ("Nina Kraviz", "Tarde"),
    ("Plastikman", "Spastik"),
]


@pytest.fixture
def popular_seeds() -> list[tuple[str, str]]:
    return POPULAR_SEEDS


@pytest.fixture
def popular_seed_queries() -> list[str]:
    """Seeds formatted as the 'Artist - Track' query string adapters expect."""
    return [f"{a} - {t}" for a, t in POPULAR_SEEDS]
