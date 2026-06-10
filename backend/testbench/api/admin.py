"""관리자 API — 시작 플랜 조회/저장 + 즉시 적용(기존 ros2 종료 후 기동)."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/plan")
async def get_plan(request: Request):
    return request.app.state.ctx.orch.get_plan()


class Plan(BaseModel):
    auto_on_boot: bool = True
    kill_on_start: bool = True
    kill_scope: list[str] = ["server", "controller"]
    steps: list[dict] = []


@router.put("/plan")
async def put_plan(plan: Plan, request: Request):
    return request.app.state.ctx.orch.set_plan(plan.model_dump())


@router.post("/apply")
async def apply(request: Request):
    """시작 플랜을 백그라운드로 실행(기존 ros2 종료 → 순서/간격대로 기동)."""
    orch = request.app.state.ctx.orch
    asyncio.create_task(orch.run_startup_plan())
    return {"ok": True, "started": True}


class KillBody(BaseModel):
    scope: list[str] = ["server", "controller"]


@router.post("/kill")
async def kill(body: KillBody, request: Request):
    """기존 ros2 프로세스만 종료(기동 없이)."""
    return await request.app.state.ctx.orch.kill_all_ros2(body.scope)
