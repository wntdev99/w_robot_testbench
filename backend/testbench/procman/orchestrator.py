"""오케스트레이터 — 자동 순차기동 + 프로파일 묶음 기동/종료(exclusive) + 헬스체크.

DESIGN.md §2.3 / §6.2. 헬스체크는 ros_bridge 그래프 조회로 토픽/서비스 존재를 확인.
상태 변화는 ws_manager 로 broadcast(snapshot).
"""
from __future__ import annotations

import asyncio
import logging
import shlex
import time

from ..config import Config, Profile
from ..ros_bridge import RosBridge
from ..ws_manager import WsManager
from .discover import parse_remote_find, parse_remote_ps, scan_local_launch_files, scan_running_launches
from .killer import kill_local_ros2
from .local import LocalRunner
from .remote_ssh import RemoteRunner
from .startup import load_plan, save_plan
from .types import ProcRecord, ProcState
from .zenoh import ZenohManager

logger = logging.getLogger("testbench.procman.orch")


def parse_launch_args(args: str) -> list[str]:
    """`ros2 launch` 인자 문자열을 토큰으로 파싱·검증한다(ros2 와 동일 규칙).

    - `shlex.split` 으로 따옴표/이스케이프까지 처리(따옴표 불균형 → 파싱 실패).
    - 각 토큰은 `name:=value` 형식이어야 한다(`:=` 포함 + 이름 비어있지 않음).
    위반 시 ValueError 를 던져 호출부가 실행을 거부하도록 한다.
    """
    if not args or not args.strip():
        return []
    try:
        tokens = shlex.split(args)
    except ValueError as exc:
        raise ValueError(f"인자 파싱 실패(따옴표 확인): {exc}") from exc
    for tok in tokens:
        if ":=" not in tok:
            raise ValueError(f"잘못된 런치 인자 '{tok}': 'name:=value' 형식이어야 합니다")
        name = tok.split(":=", 1)[0]
        if not name:
            raise ValueError(f"잘못된 런치 인자 '{tok}': 인자 이름이 비어 있습니다")
    return tokens


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
        self.startup_pending = False   # 부팅 시 시작 플랜 실행 대기(프론트 팝업으로 승인)
        self.startup_progress: dict | None = None  # 시작 플랜 진행 상태(프론트 블로킹 오버레이용)
        self._lock = asyncio.Lock()

    async def _emit_startup(self, payload: dict) -> None:
        """시작 플랜 진행 상태를 갱신하고 WS 로 push(스냅샷 → 진행 중 접속자도 수신)."""
        self.startup_progress = payload
        await self._ws.broadcast("startup_progress", payload, snapshot=True)

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

    # ── 시작 플랜 (관리자 탭) ──
    def get_plan(self) -> dict:
        return load_plan()

    def set_plan(self, plan: dict) -> dict:
        return save_plan(plan)

    async def kill_all_ros2(self, scope: list[str]) -> dict:
        out: dict = {}
        if "server" in scope:
            out["server"] = kill_local_ros2()
        if "controller" in scope and self._remote:
            await self._remote.kill_ros2()
            out["controller"] = "requested"
        return out

    def dismiss_startup(self) -> dict:
        self.startup_pending = False
        return {"ok": True}

    async def run_startup_plan(self) -> dict:
        """기존 ros2 종료(옵션) → steps 순서·간격대로 기동. 서버 단독 관리 진입점.

        각 단계 진행 상태를 `startup_progress`(WS push)로 노출해 프론트가
        블로킹 오버레이("끄는 중"/"켜는 중")로 표시·입력 차단할 수 있게 한다.
        """
        self.startup_pending = False
        plan = load_plan()
        steps = plan.get("steps", [])
        kill = bool(plan.get("kill_on_start"))
        labels: list[dict] = ([{"label": "기존 ros2 종료", "state": "pending"}] if kill else []) + \
            [{"label": s.get("label", s["id"]), "state": "pending"} for s in steps]
        total = len(labels)
        done = 0
        async with self._lock:
            logger.info("=== 시작 플랜 실행 ===")
            try:
                if kill:
                    labels[0]["state"] = "running"
                    await self._emit_startup({"active": True, "phase": "kill",
                                              "message": "기존 ros2 프로세스 종료 중…",
                                              "current": done, "total": total, "steps": labels})
                    await self.kill_all_ros2(plan.get("kill_scope", []))
                    await asyncio.sleep(1.5)
                    labels[0]["state"] = "done"
                    done += 1
                base = 1 if kill else 0
                for i, step in enumerate(steps):
                    li = base + i
                    label = step.get("label", step["id"])
                    labels[li]["state"] = "running"
                    await self._emit_startup({"active": True, "phase": "starting",
                                              "message": f"기동 중: {label}",
                                              "current": done, "total": total, "steps": labels})
                    d = float(step.get("delay_s", 0) or 0)
                    if d > 0:
                        await asyncio.sleep(d)
                    await self._start_step(step)
                    rec = self._records.get(f"startup:{step['id']}")
                    labels[li]["state"] = "failed" if (rec and rec.state == ProcState.FAILED) else "done"
                    done += 1
                logger.info("=== 시작 플랜 종료 ===")
                await self._emit_startup({"active": False, "phase": "done",
                                          "message": "시작 플랜 완료", "current": done,
                                          "total": total, "steps": labels})
            except Exception as exc:  # noqa: BLE001
                logger.exception("시작 플랜 실패")
                await self._emit_startup({"active": False, "phase": "failed",
                                          "message": f"시작 플랜 실패: {exc}", "current": done,
                                          "total": total, "steps": labels})
                raise
        return {"ok": True, "processes": self.records()}

    async def _start_step(self, step: dict) -> None:
        rid = f"startup:{step['id']}"
        rec = ProcRecord(id=rid, profile_id="startup", proc_id=step["id"],
                         machine=step.get("machine", "server"), kind=step.get("kind", "launch"),
                         command=step.get("command", ""))
        self._records[rid] = rec
        rec.state = ProcState.STARTING
        await self._broadcast()
        try:
            if step.get("kind") == "zenoh":
                res = await self._zenoh.ensure_running(rid)
                rec.owned = res.get("started_by_us", False)
                rec.state = ProcState.RUNNING if rec.owned else ProcState.EXTERNAL
                rec.pid = res.get("pid")
            elif rec.machine == "controller":
                if not self._remote:
                    raise RuntimeError("컨트롤러 머신 미설정")
                await self._remote.start(rid, step["command"])
                rec.state = ProcState.RUNNING
            else:
                rec.pid = await self._local.start(rid, step["command"])
                rec.state = ProcState.RUNNING
            rec.started_at = time.time()
        except Exception as exc:  # noqa: BLE001
            rec.state = ProcState.FAILED
            rec.message = str(exc)
            logger.exception("시작 단계 실패 %s", rid)
        await self._broadcast()

    # ── 런치 파일 런타임 발견 ──
    async def list_launch_files(self, machine: str = "server") -> list[dict]:
        if machine == "controller" and self._remote:
            ws = self._cfg.controller.ws or "~/colcon_ws"
            # isolated(install/<pkg>/share/<pkg>/launch)·merged(install/share/<pkg>/launch)
            # 레이아웃 모두 커버. -L: --symlink-install 빌드의 심볼릭 링크 추적. __pycache__ 제외.
            out = await self._remote.run_capture(
                f"find -L {ws}/install -type f -path '*/share/*/launch/*' "
                f"\\( -name '*.launch.py' -o -name '*.launch.xml' -o -name '*.launch.yaml' \\) "
                f"! -path '*__pycache__*' 2>/dev/null")
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
        # ros2 launch 인자(name:=value)를 파싱·검증 — 실패하면 레코드 생성 전 거부(ValueError).
        # 각 토큰을 shlex.quote 로 감싸 셸 인젝션 차단.
        tokens = parse_launch_args(args)
        cmd = " ".join(shlex.quote(p) for p in ["ros2", "launch", package, file, *tokens])
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
