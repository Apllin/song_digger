from contextlib import asynccontextmanager

from fastapi import FastAPI
from app.api.routes.similar import router as similar_router
from app.api.routes.suggestions import router as suggestions_router
from app.api.routes.discogs import router as discogs_router
from app.api.routes.ytm_playlist import router as ytm_playlist_router
from app.api.routes.train import router as train_router
from app.api.routes.enrich import router as enrich_router
from app.config import settings
from app.core.auth_middleware import AuthMiddleware
from app.core.metrics import MetricsMiddleware
from app.services import discogs_warm


@asynccontextmanager
async def lifespan(app: FastAPI):
    if not settings.python_service_secret:
        raise RuntimeError(
            "PYTHON_SERVICE_SECRET is required to start the python-service. Set it in .env."
        )
    # Background Discogs collaborative-cache warmer — fills the cache following
    # real search traffic, so no cron/manual step is needed. No-op until
    # DISCOGS_STATS_UNBLOCKER_URL is set (owner enumeration soft-degrades).
    discogs_warm.start()
    yield
    await discogs_warm.stop()
    from app.api.routes.similar import _cosine, _soundcloud, _trackidnet
    from app.api.routes.discogs import _discogs
    from app.api.routes.enrich import _beatport
    for adapter in (_cosine, _soundcloud, _trackidnet, _discogs, _beatport):
        await adapter.aclose()


app = FastAPI(title="Track Digger — Python Service", version="0.1.0", lifespan=lifespan)

app.add_middleware(MetricsMiddleware)
app.add_middleware(AuthMiddleware)

app.include_router(similar_router)
app.include_router(suggestions_router)
app.include_router(discogs_router)
app.include_router(ytm_playlist_router)
app.include_router(train_router)
app.include_router(enrich_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
