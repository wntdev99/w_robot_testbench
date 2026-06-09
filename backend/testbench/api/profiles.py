"""프로파일/프로세스 API — 묶음 기동/종료(exclusive), 프로세스 목록."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

router = APIRouter(prefix="/api", tags=["profiles"])


@router.get("/profiles")
async def list_profiles(request: Request):
    return request.app.state.ctx.orch.profile_states()


@router.get("/processes")
async def list_processes(request: Request):
    return request.app.state.ctx.orch.records()


@router.post("/profiles/{profile_id}/up")
async def profile_up(profile_id: str, request: Request):
    try:
        return await request.app.state.ctx.orch.profile_up(profile_id)
    except KeyError as e:
        raise HTTPException(404, str(e))


@router.post("/profiles/{profile_id}/down")
async def profile_down(profile_id: str, request: Request):
    try:
        return await request.app.state.ctx.orch.profile_down(profile_id)
    except KeyError as e:
        raise HTTPException(404, str(e))
