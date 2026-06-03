"""Tests for the shared HTTP retry helper used by adapters."""
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.adapters._http import fetch_json_with_retry, is_transient_http_error


# ── is_transient_http_error ──────────────────────────────────────────────────


def test_transient_timeout():
    assert is_transient_http_error(httpx.ReadTimeout("slow"))
    assert is_transient_http_error(httpx.ConnectTimeout("slow"))
    assert is_transient_http_error(httpx.WriteTimeout("slow"))


def test_transient_connection_errors():
    assert is_transient_http_error(httpx.RemoteProtocolError("disconnect"))
    assert is_transient_http_error(httpx.ConnectError("dns"))
    assert is_transient_http_error(httpx.ReadError("reset"))


def test_transient_5xx():
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 503
    err = httpx.HTTPStatusError("server", request=MagicMock(), response=resp)
    assert is_transient_http_error(err)


def test_permanent_4xx():
    resp = MagicMock(spec=httpx.Response)
    resp.status_code = 404
    err = httpx.HTTPStatusError("not found", request=MagicMock(), response=resp)
    assert not is_transient_http_error(err)


def test_permanent_random_exception():
    assert not is_transient_http_error(ValueError("bad payload"))


# ── fetch_json_with_retry ────────────────────────────────────────────────────


def _ok_response(payload: dict) -> MagicMock:
    resp = MagicMock(spec=httpx.Response)
    resp.raise_for_status = MagicMock(return_value=None)
    resp.json = MagicMock(return_value=payload)
    return resp


def _patch_async_client_with_get(get_mock):
    """Patch httpx.AsyncClient in the _http module so .get behaves per get_mock."""
    mock_client = MagicMock()
    mock_client.get = get_mock
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    return mock_client, patch("app.adapters._http.httpx.AsyncClient", return_value=mock_client)


async def test_returns_dict_on_success_no_retry():
    payload = {"result": "ok"}
    get_mock = AsyncMock(return_value=_ok_response(payload))
    mock_client, p = _patch_async_client_with_get(get_mock)
    with p:
        result = await fetch_json_with_retry("https://x", params={"a": "b"}, label="test")
    assert result == payload
    assert mock_client.get.await_count == 1


async def test_retries_once_on_transient_then_succeeds():
    payload = {"result": "after-retry"}
    get_mock = AsyncMock(side_effect=[httpx.RemoteProtocolError("boom"), _ok_response(payload)])
    mock_client, p = _patch_async_client_with_get(get_mock)
    with p, patch("app.adapters._http.asyncio.sleep", AsyncMock()):
        result = await fetch_json_with_retry("https://x", label="test")
    assert result == payload
    assert mock_client.get.await_count == 2


async def test_returns_none_when_both_attempts_fail_transiently():
    get_mock = AsyncMock(side_effect=httpx.ConnectError("dns"))
    mock_client, p = _patch_async_client_with_get(get_mock)
    with p, patch("app.adapters._http.asyncio.sleep", AsyncMock()):
        result = await fetch_json_with_retry("https://x", label="test")
    assert result is None
    assert mock_client.get.await_count == 2


async def test_does_not_retry_on_permanent_error():
    # raise_for_status raises a 404 HTTPStatusError — permanent, no retry.
    resp_404 = MagicMock(spec=httpx.Response)
    resp_404.status_code = 404
    err_404 = httpx.HTTPStatusError("nf", request=MagicMock(), response=resp_404)
    resp_404.raise_for_status = MagicMock(side_effect=err_404)
    get_mock = AsyncMock(return_value=resp_404)
    mock_client, p = _patch_async_client_with_get(get_mock)
    with p, patch("app.adapters._http.asyncio.sleep", AsyncMock()) as sleep_mock:
        result = await fetch_json_with_retry("https://x", label="test")
    assert result is None
    assert mock_client.get.await_count == 1
    sleep_mock.assert_not_awaited()


async def test_retries_on_5xx_then_succeeds():
    resp_503 = MagicMock(spec=httpx.Response)
    resp_503.status_code = 503
    err_503 = httpx.HTTPStatusError("svc", request=MagicMock(), response=resp_503)
    resp_503.raise_for_status = MagicMock(side_effect=err_503)
    payload = {"ok": True}
    get_mock = AsyncMock(side_effect=[resp_503, _ok_response(payload)])
    mock_client, p = _patch_async_client_with_get(get_mock)
    with p, patch("app.adapters._http.asyncio.sleep", AsyncMock()):
        result = await fetch_json_with_retry("https://x", label="test")
    assert result == payload
    assert mock_client.get.await_count == 2
