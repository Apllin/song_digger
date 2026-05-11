from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes.similar import router as similar_router
from app.api.routes.suggestions import router as suggestions_router
from app.api.routes.discogs import router as discogs_router
from app.api.routes.ytm_playlist import router as ytm_playlist_router
from app.api.routes.play_lookup import router as play_lookup_router
from app.core.metrics import MetricsMiddleware

app = FastAPI(title="Track Digger — Python Service", version="0.1.0")

# Metrics runs as the outermost layer (added last = called first by
# Starlette) so its wall/CPU timings cover CORS preflight + every route
# handler.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(MetricsMiddleware)

app.include_router(similar_router)
app.include_router(suggestions_router)
app.include_router(discogs_router)
app.include_router(ytm_playlist_router)
app.include_router(play_lookup_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
