# Copyright 2026 WATT — Apache-2.0
"""POST /api/emergency/stop — 전역 E-stop (DESIGN v0.3 §7.1, §10)."""
from __future__ import annotations

from fastapi import APIRouter, Request

from testbench.api.common import ok

router = APIRouter()


@router.post("/api/emergency/stop")
async def emergency_stop(request: Request) -> dict:
    s = request.app.state
    result = s.emergency.estop(s.bridge, s.publisher_pool)
    await s.ws_manager.broadcast("emergency", result)
    return ok(result)
