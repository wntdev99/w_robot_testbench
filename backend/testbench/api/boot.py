# Copyright 2026 WATT — Apache-2.0
"""Clean-Slate 부팅 게이트 API (DESIGN v0.3 §7.1 / 부속 D §2.5)."""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from testbench.api.common import ok, raise_http, HTTP_BAD_REQUEST

router = APIRouter()


class ResolveBody(BaseModel):
    action: str  # "kill" | "cancel"


@router.get("/api/boot/status")
async def boot_status(request: Request) -> dict:
    scan = request.app.state.boot_scan
    total = len(scan.get("server", [])) + len(scan.get("controller", []))
    return ok({"clean": total == 0, "found": total, "scan": scan})


@router.post("/api/boot/resolve")
async def boot_resolve(request: Request, body: ResolveBody) -> dict:
    if body.action not in ("kill", "cancel"):
        raise_http("bad_action", "action must be kill|cancel", HTTP_BAD_REQUEST)
    gate = request.app.state.boot_gate
    result = gate.resolve(body.action, request.app.state.boot_scan)
    # 재스캔으로 상태 갱신
    request.app.state.boot_scan = gate.scan()
    request.app.state.ws_manager.update_snapshot(boot_state=request.app.state.boot_scan)
    return ok(result)
