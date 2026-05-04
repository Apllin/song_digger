from abc import ABC, abstractmethod
from app.core.models import TrackMeta


class AbstractAdapter(ABC):
    """
    Each source (YouTube Music, Cosine.club, …) implements this
    interface. The service layer calls them uniformly.
    """

    @abstractmethod
    async def find_similar(self, query: str, limit: int) -> list[TrackMeta]:
        """Return tracks similar to `query` (track name or URL)."""
        ...

    @abstractmethod
    async def random_techno_track(self) -> TrackMeta | None:
        """Return a random techno track from this source."""
        ...
