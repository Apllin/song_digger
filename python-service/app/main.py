from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api.routes.similar import router as similar_router
from app.api.routes.random import router as random_router
from app.api.routes.suggestions import router as suggestions_router
from app.api.routes.discogs import router as discogs_router
from app.api.routes.ytm_playlist import router as ytm_playlist_router
from app.api.routes.features import router as features_router
from app.api.routes.discogs_features import router as discogs_features_router

app = FastAPI(title="Song Digger — Python Service", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(similar_router)
app.include_router(random_router)
app.include_router(suggestions_router)
app.include_router(discogs_router)
app.include_router(ytm_playlist_router)
app.include_router(features_router)
app.include_router(discogs_features_router)


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}
