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


def _remote_stats(user: str, host: str) -> dict | None:
    """201 stats — ROS2 토픽 미발행 시 SSH로 /proc 읽기 (DESIGN §12-2 fallback)."""
    try:
        r = subprocess.run(
            ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5", f"{user}@{host}",
             "cat /proc/loadavg; cat /sys/class/thermal/thermal_zone0/temp 2>/dev/null"],
            capture_output=True, text=True, timeout=8,
        )
        lines = r.stdout.splitlines()
        load = lines[0].split()[0] if lines and lines[0] else None
        temp = None
        for ln in lines[1:]:
            if ln.strip().isdigit():
                temp = round(int(ln.strip()) / 1000, 1)
                break
        return {"loadavg": load, "temp_c": temp}
    except Exception:
        return None


@router.get("/api/processes")
async def owned_processes(request: Request) -> dict:
    """owned-registry — 백엔드가 기동한 프로세스 (DESIGN §7.1, 부속 D §5)."""
    return ok({"owned": request.app.state.process_manager.status()})


@router.get("/api/system/controller")
async def controller_status(request: Request) -> dict:
    """201 토폴로지 — 연결 상태 + stats (on-demand, system_status 폴링 부담 회피)."""
    m = request.app.state.config.machines.get("controller", {})
    host, user = m.get("host"), m.get("ssh_user")
    reachable = _ping(host)
    return ok({
        "host": host,
        "reachable": reachable,                       # ping = "단독/함께"
        "stats": _remote_stats(user, host) if reachable else None,
    })
