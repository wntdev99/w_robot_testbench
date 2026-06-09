"""시스템/인프라 API — zenoh 상태, 201 연결("단독/함께"), 시스템 통계."""
from __future__ import annotations

from fastapi import APIRouter, Request

from ..monitor import local_stats

router = APIRouter(prefix="/api/system", tags=["system"])


@router.get("/status")
async def status(request: Request):
    ctx = request.app.state.ctx
    stats = await local_stats.snapshot(
        controller_reachable=ctx.controller_reachable,
        controller_host=ctx.cfg.controller.host if ctx.cfg.controller else None,
    )
    return {
        "zenoh": ctx.orch.zenoh.status(),
        "controller": {
            "host": ctx.cfg.controller.host if ctx.cfg.controller else None,
            "reachable": ctx.controller_reachable,
            "topology": "with_controller" if ctx.controller_reachable else "standalone",
        },
        "stats": stats,
    }
