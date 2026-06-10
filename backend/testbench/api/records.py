# Copyright 2026 WATT — Apache-2.0
"""자산화 API — record start/stop, verdict, 실행이력, cycle 러너 (DESIGN §7.1)."""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from testbench.api.common import HTTP_CONFLICT, HTTP_NOT_FOUND, ok, raise_http
from testbench.recorder.recorder import Recorder, records_root

router = APIRouter()


class RecordStartBody(BaseModel):
    project_id: str
    topics: list[str] | None = None


class VerdictBody(BaseModel):
    run_id: str
    result: str  # PASS | FAIL
    comment: str = ""


@router.post("/api/record/start")
async def record_start(request: Request, body: RecordStartBody) -> dict:
    s = request.app.state
    p = s.project_store.get(body.project_id)
    topics = body.topics or (p or {}).get("record", {}).get("topics", [])
    r = s.recorder.start(body.project_id, topics)
    if "error" in r:
        raise_http(r["error"], "이미 기록 중", HTTP_CONFLICT)
    return ok(r)


@router.post("/api/record/stop")
async def record_stop(request: Request) -> dict:
    return ok(request.app.state.recorder.stop())


@router.post("/api/record/verdict")
async def record_verdict(request: Request, body: VerdictBody) -> dict:
    meta = request.app.state.recorder.set_verdict(body.run_id, body.result, body.comment)
    if meta is None:
        raise_http("not_found", f"run 없음: {body.run_id}", HTTP_NOT_FOUND)
    return ok(meta)


@router.get("/api/records")
async def list_records() -> dict:
    return ok({"runs": Recorder.list_runs()})


@router.get("/api/records/{run_id}/files/{fname}")
async def record_file(run_id: str, fname: str):
    path = (records_root() / run_id / fname).resolve()
    if not path.exists() or records_root().resolve() not in path.parents:
        raise_http("not_found", "파일 없음", HTTP_NOT_FOUND)
    return FileResponse(path)


# ── cycle 러너 ──
@router.post("/api/projects/{project_id}/cycle/start")
async def cycle_start(request: Request, project_id: str) -> dict:
    s = request.app.state
    p = s.project_store.get(project_id)
    if not p:
        raise_http("not_found", f"project 없음: {project_id}", HTTP_NOT_FOUND)
    r = await s.cycle_runner.start(p, s.publisher_pool, s.bridge, s.ws_manager, s.recorder)
    if "error" in r:
        raise_http("cycle_error", r["error"], HTTP_CONFLICT)
    return ok(r)


@router.post("/api/projects/{project_id}/cycle/stop")
async def cycle_stop(request: Request, project_id: str) -> dict:
    return ok(await request.app.state.cycle_runner.stop())


@router.get("/api/cycle/state")
async def cycle_state(request: Request) -> dict:
    return ok(request.app.state.cycle_runner.state)
