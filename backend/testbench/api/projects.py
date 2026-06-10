# Copyright 2026 WATT — Apache-2.0
"""테스트 프로젝트 API — 목록/조회/실행/정지 (DESIGN v0.3 §7.1, 부속 D)."""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from testbench.api.common import HTTP_CONFLICT, HTTP_NOT_FOUND, ok, raise_http
from testbench.projects.runner import run_decision, run_project, stop_project

router = APIRouter()


class DuplicateBody(BaseModel):
    name: str | None = None


class DecisionBody(BaseModel):
    action: str  # kill | keep | abort


@router.get("/api/projects")
async def list_projects(request: Request) -> dict:
    return ok({"projects": request.app.state.project_store.list()})


@router.get("/api/projects/{project_id}")
async def get_project(request: Request, project_id: str) -> dict:
    p = request.app.state.project_store.get(project_id)
    if not p:
        raise_http("not_found", f"project not found: {project_id}", HTTP_NOT_FOUND)
    return ok(p)


@router.post("/api/projects/{project_id}/run")
async def run_project_ep(request: Request, project_id: str) -> dict:
    s = request.app.state
    p = s.project_store.get(project_id)
    if not p:
        raise_http("not_found", f"project not found: {project_id}", HTTP_NOT_FOUND)
    on_orphan = p.get("policy", {}).get("on_orphan", "ask")
    result = await run_project(s.process_manager, s.bridge, s.ws_manager, p, s.config.baseline, on_orphan)
    return ok(result)


@router.post("/api/projects/{project_id}/run/decision")
async def run_decision_ep(request: Request, project_id: str, body: DecisionBody) -> dict:
    s = request.app.state
    p = s.project_store.get(project_id)
    if not p:
        raise_http("not_found", f"project not found: {project_id}", HTTP_NOT_FOUND)
    if body.action not in ("kill", "keep", "abort"):
        raise_http("bad_action", "action must be kill|keep|abort", HTTP_CONFLICT)
    result = await run_decision(s.process_manager, s.bridge, s.ws_manager, p, s.config.baseline, body.action)
    return ok(result)


@router.post("/api/projects/{project_id}/stop")
async def stop_project_ep(request: Request, project_id: str) -> dict:
    s = request.app.state
    return ok(await stop_project(s.process_manager, s.ws_manager, project_id))


# ── 저작 CRUD (user 프로젝트, builtin 읽기전용) ──
@router.post("/api/projects")
async def create_project(request: Request, project: dict) -> dict:
    return ok(request.app.state.project_store.create(project))


@router.put("/api/projects/{project_id}")
async def update_project(request: Request, project_id: str, project: dict) -> dict:
    result = request.app.state.project_store.update(project_id, project)
    if result is None:
        raise_http("readonly", f"builtin 프로젝트는 수정 불가: {project_id}", HTTP_CONFLICT)
    return ok(result)


@router.delete("/api/projects/{project_id}")
async def delete_project(request: Request, project_id: str) -> dict:
    if not request.app.state.project_store.delete(project_id):
        raise_http("not_found", f"user 프로젝트 없음: {project_id}", HTTP_NOT_FOUND)
    return ok({"deleted": project_id})


@router.post("/api/projects/{project_id}/duplicate")
async def duplicate_project(request: Request, project_id: str, body: DuplicateBody) -> dict:
    result = request.app.state.project_store.duplicate(project_id, body.name)
    if result is None:
        raise_http("not_found", f"원본 프로젝트 없음: {project_id}", HTTP_NOT_FOUND)
    return ok(result)
