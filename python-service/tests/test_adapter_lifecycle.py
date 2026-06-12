"""Lifecycle tests: pooled client is created in __init__ and closed via aclose()."""
from app.adapters.soundcloud import SoundCloudAdapter
from app.adapters.trackidnet import TrackidnetAdapter


async def test_soundcloud_adapter_client_closed_after_aclose():
    adapter = SoundCloudAdapter()
    assert not adapter._client.is_closed
    await adapter.aclose()
    assert adapter._client.is_closed


async def test_trackidnet_adapter_client_closed_after_aclose():
    adapter = TrackidnetAdapter()
    assert not adapter._client.is_closed
    await adapter.aclose()
    assert adapter._client.is_closed
