# Copyright 2026 WATT — Apache-2.0
"""project_runner — 수렴 → preflight → 라이브 (부속 D §4).

P1: builtin 텔레옵 프로젝트 실행.
  1) 수렴: baseline ensure(zenoh 보존) + project.processes 기동(provenance=project)
  2) preflight: 위젯 의존 리소스 + resources.require 존재 검증
  3) 라이브: 위젯 구독은 클라가 WS sub 로 시작 (subscriber_pool)
  종료: project provenance 만 정리 (baseline/persistent 보존).
"""
from __future__ import annotations

import logging

from testbench.procman.baseline import baseline_up, run_processes

logger = logging.getLogger(__name__)


def check_preflight(project: dict, bridge) -> list[dict]:
    """위젯 의존 리소스 + resources.require 의 라이브 존재 검증. 미충족 목록 반환."""
    missing: list[dict] = []
    seen: set[str] = set()

    def need_topic(name: str, widget: str | None = None) -> None:
        if not name or name in seen:
            return
        seen.add(name)
        if not bridge.topic_exists(name):
            missing.append({"kind": "topic", "name": name, "widget": widget})

    for r in project.get("resources", {}).get("require", []):
        if r.get("kind") == "topic":
            need_topic(r.get("name"))
    # 위젯 파생 (구독/관찰 위젯만 — pub 위젯은 토픽 없어도 됨, 부속 D §3.2)
    for w in project.get("layout", {}).get("widgets", []):
        if w.get("kind") in ("plot.topic", "diagnostics", "state") and w.get("topic"):
            need_topic(w["topic"], w.get("id"))
    return missing


async def run_project(pm, bridge, ws, project: dict, baseline_cfg: list[dict]) -> dict:
    pid = project.get("id")
    # 1) 수렴 — baseline ensure (zenoh 보존, skip_if_running)
    await baseline_up(pm, bridge, ws, baseline_cfg)
    # 2) 수렴 — project.processes (provenance=project)
    proc_results = await run_processes(
        pm, bridge, ws, project.get("processes", []), "project", "project_progress",
    )
    # 3) preflight
    missing = check_preflight(project, bridge)
    state = "live" if not missing else "report_missing"
    await ws.broadcast("project_run", {
        "id": pid, "state": state, "processes": proc_results, "missing": missing,
    })
    logger.info("run_project %s → %s (missing=%d)", pid, state, len(missing))
    return {"id": pid, "state": state, "processes": proc_results, "missing": missing}


async def stop_project(pm, ws, project_id: str) -> dict:
    """project provenance 프로세스만 정리. baseline/persistent(zenoh) 보존."""
    ids = [op.id for op in pm.owned.values() if op.provenance == "project"]
    for i in ids:
        pm.kill(i)
    await ws.broadcast("project_stop", {"id": project_id, "stopped": ids})
    return {"id": project_id, "stopped": ids}
