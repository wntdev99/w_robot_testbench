# Copyright 2026 WATT — Apache-2.0
"""baseline 오케스트레이터 — 순차 기동 + healthcheck + 종료.

DESIGN v0.3 §2.3·§6.2 / 부속 D §2.5.1. bootgate_test Phase B 로직의 백엔드 구현.
2026-06-09 end-to-end 실증된 흐름: zenoh → robot_urdf → controller(201 SSH),
각 healthcheck 통과 후 진행. skip_if_running 으로 idempotent.
"""
from __future__ import annotations

import asyncio
import logging
import subprocess
import time

logger = logging.getLogger(__name__)


def _pgrep(match: str) -> bool:
    try:
        return subprocess.run(["pgrep", "-f", match], capture_output=True,
                              timeout=5).returncode == 0
    except Exception:
        return False


def check_healthcheck(hc: dict, bridge) -> bool:
    """type: process(match) | topic(topic) | node(node). 없으면 통과로 간주."""
    t = hc.get("type")
    if t == "process":
        return _pgrep(hc.get("match", ""))
    if t == "topic":
        return bridge.topic_exists(hc.get("topic", ""))
    if t == "node":
        return bridge.node_exists(hc.get("node", ""))
    return True


async def _wait_healthcheck(hc: dict, bridge, timeout_s: float) -> bool:
    end = time.monotonic() + timeout_s
    while time.monotonic() < end:
        if check_healthcheck(hc, bridge):
            return True
        await asyncio.sleep(1.0)
    return check_healthcheck(hc, bridge)


async def baseline_up(pm, bridge, ws, baseline_cfg: list[dict]) -> list[dict]:
    """config.baseline 순차 기동. 실패(healthcheck timeout) 시 중단."""
    results: list[dict] = []
    for item in baseline_cfg:
        bid = item["id"]
        machine = item.get("machine", "server")
        hc = item.get("healthcheck", {})
        timeout_s = float(hc.get("timeout_s", 20))

        # idempotent: 이미 떠 있으면 skip
        if item.get("skip_if_running") and check_healthcheck(hc, bridge):
            results.append({"id": bid, "status": "skipped"})
            await ws.broadcast("baseline_progress", {"id": bid, "status": "skipped"})
            continue

        # 기동 (local=server / remote=controller SSH)
        persistent = bool(item.get("persistent", False))
        if machine == "server":
            pm.spawn_local(bid, item["command"], persistent=persistent)
        else:
            pm.spawn_remote(bid, item["command"], machine, persistent=persistent)

        ok = await _wait_healthcheck(hc, bridge, timeout_s)
        status = "ok" if ok else "timeout"
        results.append({"id": bid, "status": status})
        await ws.broadcast("baseline_progress", {"id": bid, "status": status})
        if not ok:
            logger.warning("baseline '%s' healthcheck timeout → 중단", bid)
            break
    await ws.broadcast("baseline_done", {"results": results})
    return results


async def baseline_down(pm, ws) -> dict:
    """baseline 프로세스 종료 (PID/PGID 기반). persistent(zenoh 등 인프라 전제)는 보존."""
    ids = [op.id for op in pm.owned.values()
           if op.provenance == "baseline" and not op.persistent]
    kept = [op.id for op in pm.owned.values() if op.persistent]
    for bid in ids:
        pm.kill(bid)
    await ws.broadcast("baseline_done", {"down": ids, "kept": kept})
    return {"down": ids, "kept_persistent": kept}
