"""관리자 API — 시작 플랜 조회/저장 + 즉시 적용(기존 ros2 종료 후 기동)."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/plan")
async def get_plan(request: Request):
    return request.app.state.ctx.orch.get_plan()


@router.get("/status")
async def status(request: Request):
    """부팅 시작 플랜 대기 여부 + 플랜(프론트 팝업용)."""
    orch = request.app.state.ctx.orch
    return {"startup_pending": orch.startup_pending, "plan": orch.get_plan()}


@router.post("/dismiss")
async def dismiss(request: Request):
    """시작 플랜 실행 없이 대기 해제(건너뛰기)."""
    return request.app.state.ctx.orch.dismiss_startup()


class Plan(BaseModel):
    auto_on_boot: bool = True
    kill_on_start: bool = True
    kill_scope: list[str] = ["server", "controller"]
    steps: list[dict] = []


@router.put("/plan")
async def put_plan(plan: Plan, request: Request):
    # pydantic v2(model_dump)·v1(dict) 모두 지원 (apt python3-pydantic 은 v1)
    data = plan.model_dump() if hasattr(plan, "model_dump") else plan.dict()
    return request.app.state.ctx.orch.set_plan(data)


@router.post("/apply")
async def apply(request: Request):
    """시작 플랜을 백그라운드로 실행(기존 ros2 종료 → 순서/간격대로 기동)."""
    orch = request.app.state.ctx.orch
    orch.startup_pending = False
    asyncio.create_task(orch.run_startup_plan())
    return {"ok": True, "started": True}


class KillBody(BaseModel):
    scope: list[str] = ["server", "controller"]


@router.post("/kill")
async def kill(body: KillBody, request: Request):
    """기존 ros2 프로세스만 종료(기동 없이)."""
    return await request.app.state.ctx.orch.kill_all_ros2(body.scope)
