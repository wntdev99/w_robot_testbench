# Copyright 2026 WATT — Apache-2.0
"""GET /api/system/status — zenoh·202/201·CPU/온도 (DESIGN v0.3 §7.1)."""
from __future__ import annotations

import shutil
import subprocess

import psutil
from fastapi import APIRouter, Request

from testbench.api.common import ok

router = APIRouter()


def _proc_running(match: str) -> bool:
    try:
        r = subprocess.run(["pgrep", "-f", match], capture_output=True, timeout=5)
        return r.returncode == 0
    except Exception:
        return False


def _ping(host: str) -> bool:
    if not host or not shutil.which("ping"):
        return False
    try:
        r = subprocess.run(
            ["ping", "-c", "1", "-W", "1", host], capture_output=True, timeout=4,
        )
        return r.returncode == 0
    except Exception:
        return False


def _cpu_temp() -> float | None:
    try:
        temps = psutil.sensors_temperatures()
    except Exception:
        return None
    for entries in temps.values():
        for e in entries:
            if e.current:
                return round(e.current, 1)
    return None


@router.get("/api/system/status")
async def system_status(request: Request) -> dict:
    cfg = request.app.state.config
    bridge = request.app.state.bridge

    zenoh_match = cfg.zenoh.get("check", {}).get("match", "rmw_zenohd")
    ctrl_host = cfg.machines.get("controller", {}).get("host")

    nodes = bridge.list_nodes() if bridge else []
    return ok({
        "zenoh": _proc_running(zenoh_match),
        "controller_201": _ping(ctrl_host),     # ping 으로 "단독/함께" 판정 (P0)
        "cpu_percent": psutil.cpu_percent(interval=None),
        "mem_percent": psutil.virtual_memory().percent,
        "temp_c": _cpu_temp(),
        "node_count": len(nodes),
    })
