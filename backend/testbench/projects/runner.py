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


def project_orphans(pm, project: dict, baseline_cfg: list[dict]) -> list[str]:
    """owned 중 desired(baseline ∪ project.processes)에 없는 것 = orphan(이전 프로젝트 잔여).

    baseline/persistent(zenoh)는 desired에 포함되어 보존된다.
    """
    desired = {b["id"] for b in baseline_cfg} | {p["id"] for p in project.get("processes", [])}
    return [op.id for op in pm.owned.values() if op.id not in desired]


async def run_project(pm, bridge, ws, project: dict, baseline_cfg: list[dict],
                      on_orphan: str = "ask") -> dict:
    """수렴 진입 — orphan 있으면 정책(ask/kill/keep)에 따라 확인/종료 후 기동."""
    pid = project.get("id")
    orphans = project_orphans(pm, project, baseline_cfg)
    if orphans and on_orphan == "ask":
        await ws.broadcast("confirm_required", {"id": pid, "orphans": orphans})
        return {"id": pid, "state": "confirm_required", "orphans": orphans}
    if orphans and on_orphan == "kill":
        for oid in orphans:
            pm.kill(oid)
    return await _converge(pm, bridge, ws, project, baseline_cfg)


async def run_decision(pm, bridge, ws, project: dict, baseline_cfg: list[dict],
                       action: str) -> dict:
    """confirm_required 후 사용자 결정: kill(orphan 종료 후 기동) | keep | abort."""
    pid = project.get("id")
    if action == "abort":
        await ws.broadcast("project_run", {"id": pid, "state": "aborted"})
        return {"id": pid, "state": "aborted"}
    if action == "kill":
        for oid in project_orphans(pm, project, baseline_cfg):
            pm.kill(oid)
    # keep: orphan 유지하고 기동
    return await _converge(pm, bridge, ws, project, baseline_cfg)


async def _converge(pm, bridge, ws, project: dict, baseline_cfg: list[dict]) -> dict:
    pid = project.get("id")
    # 수렴 — baseline ensure(zenoh 보존) + project.processes(provenance=project)
    await baseline_up(pm, bridge, ws, baseline_cfg)
    proc_results = await run_processes(
        pm, bridge, ws, project.get("processes", []), "project", "project_progress",
    )
    # preflight
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
