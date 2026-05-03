"""
Feature extraction endpoint. Called by the web service after a search
completes — compute C1 features per candidate and persist them.

Eventually-consistent for C2 features (Discogs-derived); those land later
via a separate background route per Stage C plan.
"""
from fastapi import APIRouter
from pydantic import BaseModel

from app.core.db import upsert_candidate_features_batch
from app.feature_extraction.cheap import extract_cheap_features

router = APIRouter()


class CandidateInput(BaseModel):
    trackId: str
    bpm: float | None = None
    key: str | None = None
    energy: float | None = None
    label: str | None = None
    genre: str | None = None
    embedUrl: str | None = None
    nSources: int
    topRank: int
    rrfScore: float


class ExtractRequest(BaseModel):
    search_query_id: str
    seed_bpm: float | None = None
    seed_key: str | None = None
    seed_energy: float | None = None
    seed_label: str | None = None
    seed_genre: str | None = None
    candidates: list[CandidateInput]


@router.post("/features/extract")
async def extract_features(req: ExtractRequest) -> dict:
    rows: list[dict] = []
    for c in req.candidates:
        feats = extract_cheap_features(
            candidate=c.model_dump(),
            seed_bpm=req.seed_bpm,
            seed_key=req.seed_key,
            seed_energy=req.seed_energy,
            seed_label=req.seed_label,
            seed_genre=req.seed_genre,
            n_sources=c.nSources,
            top_rank=c.topRank,
            rrf_score=c.rrfScore,
        )
        rows.append({
            "searchQueryId": req.search_query_id,
            "trackId": c.trackId,
            **feats,
        })

    await upsert_candidate_features_batch(rows)
    return {"persisted": len(rows)}
