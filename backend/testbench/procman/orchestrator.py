"""오케스트레이터 — 자동 순차기동 + 프로파일 묶음 기동/종료(exclusive) + 헬스체크.

DESIGN.md §2.3 / §6.2. 헬스체크는 ros_bridge 그래프 조회로 토픽/서비스 존재를 확인.
상태 변화는 ws_manager 로 broadcast(snapshot).
"""
from __future__ import annotations

import asyncio
import logging
import time

from ..config import Config, Profile
from ..ros_bridge import RosBridge
from ..ws_manager import WsManager
from .discover import parse_remote_find, parse_remote_ps, scan_local_launch_files, scan_running_launches
from .local import LocalRunner
from .remote_ssh import RemoteRunner
from .types import ProcRecord, ProcState
from .zenoh import ZenohManager

logger = logging.getLogger("testbench.procman.orch")


class Orchestrator:
    def __init__(self, cfg: Config, ros: RosBridge, ws: WsManager) -> None:
        self._cfg = cfg
        self._ros = ros
        self._ws = ws
        self._local = LocalRunner(setup=cfg.server.setup)
        ctrl = cfg.controller
        self._remote = (
            RemoteRunner(ctrl.host, ctrl.ssh_user or "ubuntu", ctrl.setup)
            if ctrl else None
        )
        z = cfg.zenoh
        self._zenoh = ZenohManager(
            z.get("router_cmd", "ros2 run rmw_zenoh_cpp rmw_zenohd"),
            z.get("process_match", "rmw_zenohd"),
            self._local,
            host=z.get("router_host") or cfg.server.host,
            port=z.get("router_port", 7447),
        )
        self._records: dict[str, ProcRecord] = {}
        self._up_profiles: set[str] = set()
        self._adhoc_seq = 0
        self._lock = asyncio.Lock()

    # ── 조회 ──
    def records(self) -> list[dict]:
        return [r.to_dict() for r in self._records.values()]

    @property
    def zenoh(self) -> ZenohManager:
        return self._zenoh

    @property
    def remote(self) -> RemoteRunner | None:
        return self._remote

    async def _broadcast(self) -> None:
        await self._ws.broadcast("processes", self.records(), snapshot=True)

    # ── 헬스체크 ──
    async def _healthcheck(self, hc: dict | None) -> bool:
        if not hc:
            return True
        timeout = float(hc.get("timeout_s", 15))
        deadline = time.time() + timeout
        kind = hc.get("type")
        target = hc.get("topic") or hc.get("service")
        while time.time() < deadline:
            try:
                if kind == "topic" and self._ros.get_topic_type(target):
                    return True
                if kind == "service":
                    names = [s["service"] for s in self._ros.list_services()]
                    if target in names:
                        return True
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(0.5)
        return False

    # ── 단위 프로세스 기동 ──
    async def _start_proc(self, profile: Profile, proc: dict) -> ProcRecord:
        rid = f"{profile.id}:{proc['id']}"
        rec = ProcRecord(
            id=rid, profile_id=profile.id, proc_id=proc["id"],
            machine=proc.get("machine", "server"), kind=proc.get("kind", "launch"),
            command=proc["command"],
        )
        self._records[rid] = rec
        rec.state = ProcState.STARTING
        await self._broadcast()
        try:
            if proc.get("kind") == "zenoh":
                res = await self._zenoh.ensure_running(rid)
                rec.owned = res.get("started_by_us", False)
                rec.state = ProcState.RUNNING if rec.owned else ProcState.EXTERNAL
                rec.pid = res.get("pid")
            elif rec.machine == "controller":
                if not self._remote:
                    raise RuntimeError("컨트롤러 머신 미설정")
                await self._remote.start(rid, proc["command"])
                rec.state = ProcState.RUNNING
            else:
                rec.pid = await self._local.start(rid, proc["command"])
                rec.state = ProcState.RUNNING

            ok = await self._healthcheck(proc.get("healthcheck"))
            if not ok:
                rec.state = ProcState.FAILED
                rec.message = "헬스체크 시간초과"
                logger.warning("헬스체크 실패: %s", rid)
            else:
                rec.started_at = rec.started_at or time.time()
        except Exception as exc:  # noqa: BLE001
            rec.state = ProcState.FAILED
            rec.message = str(exc)
            logger.exception("기동 실패 %s", rid)
        await self._broadcast()
        return rec

    @staticmethod
    def _ordered(processes: list[dict]) -> list[dict]:
        """depends_on 위상 정렬(단순)."""
        by_id = {p["id"]: p for p in processes}
        done: list[dict] = []
        seen: set[str] = set()

        def visit(p: dict) -> None:
            if p["id"] in seen:
                return
            for dep in p.get("depends_on", []):
                if dep in by_id:
                    visit(by_id[dep])
            seen.add(p["id"])
            done.append(p)

        for p in processes:
            visit(p)
        return done

    # ── 자동 순차기동 ──
    async def autostart(self) -> None:
        prof = self._cfg.profiles.get("_autostart")
        if not prof:
            logger.warning("_autostart 프로파일 없음")
            return
        async with self._lock:
            logger.info("=== 자동 순차기동 시작 ===")
            for proc in self._ordered(prof.processes):
                rec = await self._start_proc(prof, proc)
                if rec.state == ProcState.FAILED:
                    logger.error("autostart 중단: %s 실패", rec.id)
                    break
            self._up_profiles.add(prof.id)
            logger.info("=== 자동 순차기동 종료 ===")

    # ── 프로파일 기동/종료 ──
    async def profile_up(self, profile_id: str) -> dict:
        prof = self._cfg.profiles.get(profile_id)
        if not prof:
            raise KeyError(f"프로파일 없음: {profile_id}")
        async with self._lock:
            if prof.exclusive:
                for pid in list(self._up_profiles):
                    other = self._cfg.profiles.get(pid)
                    if other and not other.persistent and pid != profile_id:
                        await self._profile_down_inner(other)
            for proc in self._ordered(prof.processes):
                await self._start_proc(prof, proc)
            self._up_profiles.add(profile_id)
        return {"profile": profile_id, "processes": self.records()}

    async def _profile_down_inner(self, prof: Profile) -> None:
        for proc in reversed(self._ordered(prof.processes)):
            rid = f"{prof.id}:{proc['id']}"
            rec = self._records.get(rid)
            if not rec:
                continue
            rec.state = ProcState.STOPPING
            await self._broadcast()
            if rec.machine == "controller" and self._remote:
                await self._remote.stop(rid)
            elif proc.get("kind") != "zenoh":   # zenoh 는 persistent, 종료 안 함
                await self._local.stop(rid)
            self._records.pop(rid, None)
        self._up_profiles.discard(prof.id)
        await self._broadcast()

    async def profile_down(self, profile_id: str) -> dict:
        prof = self._cfg.profiles.get(profile_id)
        if not prof:
            raise KeyError(f"프로파일 없음: {profile_id}")
        async with self._lock:
            await self._profile_down_inner(prof)
        return {"profile": profile_id, "processes": self.records()}

    def profile_states(self) -> list[dict]:
        out = []
        for pid, prof in self._cfg.profiles.items():
            out.append({
                "id": pid, "label": prof.label, "category": prof.category,
                "persistent": prof.persistent, "exclusive": prof.exclusive,
                "up": pid in self._up_profiles,
            })
        return out

    # ── 런치 파일 런타임 발견 ──
    async def list_launch_files(self, machine: str = "server") -> list[dict]:
        if machine == "controller" and self._remote:
            ws = self._cfg.controller.ws or "~/colcon_ws"
            out = await self._remote.run_capture(
                f"find {ws}/install/*/share/*/launch -type f -name '*.launch.*' 2>/dev/null")
            return parse_remote_find(out)
        return scan_local_launch_files()

    async def list_running_launches(self, machine: str = "server") -> list[dict]:
        """실제 실행 중인 ros2 launch 프로세스 (테스트벤치 외부 포함)."""
        if machine == "controller" and self._remote:
            out = await self._remote.run_capture(
                "ps -eo pid=,args= 2>/dev/null | grep 'ros2 launch' | grep -v grep")
            return parse_remote_ps(out)
        return scan_running_launches()

    # ── ad-hoc 런치 실행/종료 (프로파일과 무관한 단건) ──
    async def run_launch(self, machine: str, package: str, file: str, args: str = "") -> dict:
        cmd = f"ros2 launch {package} {file} {args}".strip()
        self._adhoc_seq += 1
        rid = f"adhoc:{self._adhoc_seq}"
        rec = ProcRecord(id=rid, profile_id="adhoc", proc_id=f"{package}/{file}",
                         machine=machine, kind="launch", command=cmd)
        self._records[rid] = rec
        rec.state = ProcState.STARTING
        await self._broadcast()
        try:
            if machine == "controller":
                if not self._remote:
                    raise RuntimeError("컨트롤러 머신 미설정")
                await self._remote.start(rid, cmd)
            else:
                rec.pid = await self._local.start(rid, cmd)
            rec.state = ProcState.RUNNING
            rec.started_at = time.time()
        except Exception as exc:  # noqa: BLE001
            rec.state = ProcState.FAILED
            rec.message = str(exc)
        await self._broadcast()
        return rec.to_dict()

    async def stop_process(self, rid: str) -> dict:
        rec = self._records.get(rid)
        if not rec:
            return {"ok": False, "reason": "unknown id"}
        rec.state = ProcState.STOPPING
        await self._broadcast()
        if rec.machine == "controller" and self._remote:
            await self._remote.stop(rid)
        elif rec.kind != "zenoh":
            await self._local.stop(rid)
        self._records.pop(rid, None)
        await self._broadcast()
        return {"ok": True, "id": rid}

    # ── 정리 (종료 시 owned 프로세스만) ──
    async def shutdown(self) -> None:
        await self._local.stop_all()
        if self._remote:
            await self._remote.stop_all()
            await self._remote.close()
