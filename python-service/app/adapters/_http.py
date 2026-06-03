"""Shared HTTP helpers for adapters that use httpx.

The primary concern: distinguish a transient network failure (which the caller
should NOT cache as "API returned nothing") from a real "API said 0 results".
A single connection blip would otherwise poison long-TTL caches like
LastfmArtistSimilars, leaving an empty list cached for days.

Usage:
    data = await fetch_json_with_retry(url, params=params, label="lastfm.artist")
    if data is None:
        return None  # transient — caller must not cache
    # parse data normally
"""
import asyncio

import httpx

_DEFAULT_TIMEOUT_S = 8.0
_RETRY_DELAY_S = 0.5
_MAX_ATTEMPTS = 2


def is_transient_http_error(exc: BaseException) -> bool:
    """Network-level blips and 5xx that warrant a single retry rather than a
    silent empty result. 4xx (404/410/429) is treated as permanent — retrying
    a not-found or rate-limit response doesn't change anything within 0.5s."""
    if isinstance(
        exc,
        (
            httpx.TimeoutException,
            httpx.RemoteProtocolError,
            httpx.ConnectError,
            httpx.ReadError,
            httpx.WriteError,
        ),
    ):
        return True
    if isinstance(exc, httpx.HTTPStatusError) and 500 <= exc.response.status_code < 600:
        return True
    return False


async def fetch_json_with_retry(
    url: str,
    *,
    params: dict | None = None,
    headers: dict | None = None,
    timeout: float = _DEFAULT_TIMEOUT_S,
    label: str,
    client: httpx.AsyncClient | None = None,
) -> dict | None:
    """GET `url` and parse JSON. Retries once on transient errors.

    Returns the parsed dict on success, or None when both attempts failed.
    The caller must treat None as "do not cache, do not infer absence of data";
    a successful response with an empty list/dict is distinct and returned
    normally.

    Pass `client` to reuse an existing AsyncClient (connection pooling);
    otherwise a fresh client is created per attempt.
    """
    for attempt in range(_MAX_ATTEMPTS):
        try:
            if client is not None:
                resp = await client.get(url, params=params, headers=headers)
            else:
                async with httpx.AsyncClient(timeout=timeout, headers=headers) as c:
                    resp = await c.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            if attempt + 1 < _MAX_ATTEMPTS and is_transient_http_error(e):
                await asyncio.sleep(_RETRY_DELAY_S)
                continue
            print(f"[{label}] HTTP error: {e}")
            return None
    return None
