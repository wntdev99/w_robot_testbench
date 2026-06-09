"""네비게이션 시각화 API — 맵 PNG/메타 + 오버레이(scan/footprint/pose)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request, Response

router = APIRouter(prefix="/api/nav", tags=["nav"])


@router.get("/map/meta")
async def map_meta(request: Request):
    nav = request.app.state.ctx.nav
    nav.ensure_started()
    return {"available": nav.available(), **nav.map_meta()}


@router.get("/map.png")
async def map_png(request: Request):
    nav = request.app.state.ctx.nav
    nav.ensure_started()
    png = nav.map_png()
    if png is None:
        raise HTTPException(404, "맵 없음 (map_server 미기동?)")
    return Response(content=png, media_type="image/png")


@router.get("/overlay")
async def overlay(request: Request):
    nav = request.app.state.ctx.nav
    nav.ensure_started()
    return nav.overlay()
