# Copyright 2026 WATT — Apache-2.0
"""baseline API — 동적 baseline 조회·기동·종료 (DESIGN v0.3 §7.1)."""
from __future__ import annotations

from fastapi import APIRouter, Request

from testbench.api.common import ok
from testbench.procman.baseline import baseline_down, baseline_up, check_healthcheck

router = APIRouter()


@router.get("/api/baseline")
async def get_baseline(request: Request) -> dict:
    s = request.app.state
    items = []
    for item in s.config.baseline:
        items.append({
            "id": item.get("id"),
            "machine": item.get("machine", "server"),
            "command": item.get("command"),
            "running": check_healthcheck(item.get("healthcheck", {}), s.bridge),
            "owned": item.get("id") in s.process_manager.owned,
        })
    return ok({"baseline": items})


@router.post("/api/baseline/up")
async def baseline_up_ep(request: Request) -> dict:
    s = request.app.state
    results = await baseline_up(s.process_manager, s.bridge, s.ws_manager, s.config.baseline)
    return ok({"results": results})


@router.post("/api/baseline/down")
async def baseline_down_ep(request: Request) -> dict:
    s = request.app.state
    return ok(await baseline_down(s.process_manager, s.ws_manager))
