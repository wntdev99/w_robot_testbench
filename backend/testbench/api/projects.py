# Copyright 2026 WATT — Apache-2.0
"""테스트 프로젝트 API — 목록/조회/실행/정지 (DESIGN v0.3 §7.1, 부속 D)."""
from __future__ import annotations

from fastapi import APIRouter, Request

from testbench.api.common import HTTP_NOT_FOUND, ok, raise_http
from testbench.projects.runner import run_project, stop_project

router = APIRouter()


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
    result = await run_project(s.process_manager, s.bridge, s.ws_manager, p, s.config.baseline)
    return ok(result)


@router.post("/api/projects/{project_id}/stop")
async def stop_project_ep(request: Request, project_id: str) -> dict:
    s = request.app.state
    return ok(await stop_project(s.process_manager, s.ws_manager, project_id))
