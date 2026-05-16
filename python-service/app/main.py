from fastapi import FastAPI
from app.api.routes.bandcamp import router as bandcamp_router
from app.api.routes.discogs import router as discogs_router
from app.api.routes.discography import router as discography_router
from app.api.routes.similar import router as similar_router
from app.api.routes.suggestions import router as suggestions_router
from app.api.routes.ytm_playlist import router as ytm_playlist_router
from app.api.routes.train import router as train_router
from app.core.metrics import MetricsMiddleware

app = FastAPI(title="Track Digger — Python Service", version="0.1.0")

app.add_middleware(MetricsMiddleware)

app.include_router(similar_router)
app.include_router(suggestions_router)
app.include_router(discogs_router)
app.include_router(bandcamp_router)
app.include_router(discography_router)
app.include_router(ytm_playlist_router)
app.include_router(train_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
