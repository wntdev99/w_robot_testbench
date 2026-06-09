"""프로파일/프로세스 API — 묶음 기동/종료(exclusive), 프로세스 목록."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

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


@router.get("/launch/files")
async def launch_files(request: Request, machine: str = "server"):
    """런타임에 실행 가능한 ros2 launch 파일 목록 (설치된 패키지 스캔)."""
    return await request.app.state.ctx.orch.list_launch_files(machine)


@router.get("/processes/running")
async def running_launches(request: Request, machine: str = "server"):
    """실제 실행 중인 ros2 launch 프로세스 (외부 포함)."""
    return await request.app.state.ctx.orch.list_running_launches(machine)


class RunLaunchBody(BaseModel):
    machine: str = "server"
    package: str
    file: str
    args: str = ""


@router.post("/launch/run")
async def run_launch(body: RunLaunchBody, request: Request):
    return await request.app.state.ctx.orch.run_launch(body.machine, body.package, body.file, body.args)


class StopBody(BaseModel):
    id: str


@router.post("/launch/stop")
async def stop_process(body: StopBody, request: Request):
    return await request.app.state.ctx.orch.stop_process(body.id)
