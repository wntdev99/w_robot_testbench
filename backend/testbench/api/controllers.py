# Copyright 2026 WATT — Apache-2.0
"""controller_manager API — 목록/스위치 (DESIGN v0.3 §7.1)."""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from testbench.api.common import ok

router = APIRouter()


class SwitchBody(BaseModel):
    activate: list[str] = []
    deactivate: list[str] = []
    strictness: int = 1


@router.get("/api/controllers")
async def list_controllers(request: Request) -> dict:
    return ok(await request.app.state.controller_mgr.list())


@router.post("/api/controllers/switch")
async def switch_controllers(request: Request, body: SwitchBody) -> dict:
    return ok(await request.app.state.controller_mgr.switch(
        body.activate, body.deactivate, body.strictness))
