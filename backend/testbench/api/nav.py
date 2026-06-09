"""네비게이션 시각화 API — 맵 PNG/메타 + 오버레이(scan/footprint/pose) + 주행 취소."""
from __future__ import annotations

import asyncio

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


NAV_ACTIONS = ["/navigate_to_pose", "/navigate_through_poses"]


@router.post("/cancel")
async def cancel(request: Request):
    """진행 중인 네비게이션(액션 goal) 전체 취소."""
    ros = request.app.state.ctx.ros
    out = {}
    for a in NAV_ACTIONS:
        try:
            out[a] = await asyncio.to_thread(ros.cancel_all_goals, a, 1.5)
        except Exception as e:  # noqa: BLE001 — 액션 서버 미존재 등
            out[a] = {"error": str(e)}
    return out
