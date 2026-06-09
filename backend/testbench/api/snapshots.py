"""UI 구성 스냅샷 API."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import snapshots as store

router = APIRouter(prefix="/api/snapshots", tags=["snapshots"])


@router.get("")
async def list_all():
    return store.list_snapshots()


class SaveBody(BaseModel):
    name: str
    data: dict


@router.post("")
async def save(body: SaveBody):
    if not body.name.strip():
        raise HTTPException(400, "이름이 비어 있습니다")
    return store.save_snapshot(body.name, body.data)


@router.get("/{name}")
async def load(name: str):
    doc = store.load_snapshot(name)
    if doc is None:
        raise HTTPException(404, f"스냅샷 없음: {name}")
    return doc


@router.delete("/{name}")
async def delete(name: str):
    return {"ok": store.delete_snapshot(name)}
