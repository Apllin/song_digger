"""Tests for AuthMiddleware shared-secret enforcement."""

import pytest
from httpx import ASGITransport, AsyncClient

from app.config import settings
from app.main import app


@pytest.fixture
def anyio_backend():
    return "asyncio"


async def test_health_bypasses_auth_without_secret(monkeypatch):
    """/health is always reachable, even with no secret configured."""
    monkeypatch.setattr(settings, "python_service_secret", "")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200


async def test_no_secret_rejects_non_health_request(monkeypatch):
    """Secret unset → fail-closed: non-health requests get a loud 500."""
    monkeypatch.setattr(settings, "python_service_secret", "")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/similar", content=b"{}")
    assert resp.status_code == 500


async def test_secret_set_rejects_without_header(monkeypatch):
    """Secret set, no header → 401."""
    monkeypatch.setattr(settings, "python_service_secret", "supersecret")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post("/similar", content=b"{}")
    assert resp.status_code == 401


async def test_secret_set_allows_with_correct_header(monkeypatch):
    """Secret set, correct header → passes auth (may return non-401)."""
    monkeypatch.setattr(settings, "python_service_secret", "supersecret")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.post(
            "/similar",
            content=b"{}",
            headers={"x-internal-auth": "supersecret"},
        )
    assert resp.status_code != 401


async def test_health_bypasses_auth_even_with_secret(monkeypatch):
    """/health is always accessible regardless of secret."""
    monkeypatch.setattr(settings, "python_service_secret", "supersecret")
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        resp = await client.get("/health")
    assert resp.status_code == 200
