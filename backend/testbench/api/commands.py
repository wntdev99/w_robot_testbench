# Copyright 2026 WATT — Apache-2.0
"""동적 명령 API — publish (DESIGN v0.3 §7.1). service/action 은 향후."""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from testbench.api.common import HTTP_BAD_REQUEST, ok, raise_http

router = APIRouter()


class PublishBody(BaseModel):
    topic: str
    type: str
    values: dict = {}


class SpawnBody(BaseModel):
    id: str
    command: str
    machine: str = "server"  # server | controller


class ServiceBody(BaseModel):
    name: str
    type: str
    values: dict = {}


@router.post("/api/publish")
async def publish(request: Request, body: PublishBody) -> dict:
    try:
        result = request.app.state.publisher_pool.publish(body.topic, body.type, body.values)
    except Exception as e:
        raise_http("publish_failed", str(e), HTTP_BAD_REQUEST)
    return ok(result)


# ── 런치/노드 ad-hoc 실행 (process 위젯, owned-registry provenance=ad-hoc) ──
@router.post("/api/process/spawn")
async def spawn_process(request: Request, body: SpawnBody) -> dict:
    pm = request.app.state.process_manager
    if body.machine == "controller":
        op = pm.spawn_remote(body.id, body.command, "controller", provenance="ad-hoc")
    else:
        op = pm.spawn_local(body.id, body.command, provenance="ad-hoc")
    return ok({"id": op.id, "pid": op.pid, "machine": op.machine})


@router.post("/api/process/{proc_id}/kill")
async def kill_process(request: Request, proc_id: str) -> dict:
    request.app.state.process_manager.kill(proc_id)
    return ok({"killed": proc_id})


@router.post("/api/service")
async def call_service(request: Request, body: ServiceBody) -> dict:
    try:
        result = await request.app.state.service_caller.call(body.name, body.type, body.values)
    except Exception as e:
        raise_http("service_failed", str(e), HTTP_BAD_REQUEST)
    return ok(result)
