import pytest

from app.config import settings

TEST_SERVICE_SECRET = "test-secret"


@pytest.fixture(autouse=True)
def _default_service_secret(monkeypatch):
    """Default the shared secret so in-process endpoint tests pass auth.

    The middleware is fail-closed, so requests with no secret configured get a
    500. Individual tests override this with their own monkeypatch when they
    need a different (or empty) secret.
    """
    monkeypatch.setattr(settings, "python_service_secret", TEST_SERVICE_SECRET)
