# Copyright 2026 WATT — Apache-2.0
"""프로세스 관리 — local subprocess + remote SSH 기동/종료 + owned_registry.

검증된 원칙 (2026-06-09, docs/verification-2026-06-09.md):
  - 기동: setsid(새 세션/프로세스 그룹). local=Popen(start_new_session), 원격=SSH+setsid
    (SSH 끊겨도 지속). launch 자식 트리는 PGID로 일괄 종료.
  - 종료: PID/PGID 기반(`kill -TERM -<PGID>`). **`pkill -f` 금지**(오살 실측).
  - 소유권: 기동 PID를 owned_registry에 기록 → provenance(baseline/project/ad-hoc)
    추적 + boot_gate self-제외 (부속 D §5).
  - 201 setup의 작은따옴표(ZENOH_CONFIG_OVERRIDE)는 shlex.quote 로 안전 처리.
"""
from __future__ import annotations

import logging
import os
import shlex
import signal
import subprocess
import time
from dataclasses import dataclass

logger = logging.getLogger(__name__)


@dataclass
class OwnedProcess:
    id: str
    machine: str                 # "server" | "controller"
    command: str
    pid: int | None = None
    pgid: int | None = None
    provenance: str = "baseline"  # baseline | project | ad-hoc


class ProcessManager:
    def __init__(self, config) -> None:
        self.cfg = config
        self.owned: dict[str, OwnedProcess] = {}

    # ── machine 헬퍼 ──
    def _machine(self, key: str) -> dict:
        return self.cfg.machines.get(key, {})

    def _ssh_base(self, m: dict) -> list[str]:
        return ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8",
                f"{m.get('ssh_user')}@{m.get('host')}"]

    @staticmethod
    def _wrap(setup: str, command: str) -> str:
        return (f"{setup}; " if setup else "") + f"exec {command}"

    # ── 기동 ──
    def spawn_local(self, id: str, command: str, provenance: str = "baseline") -> OwnedProcess:
        setup = self._machine("server").get("setup", "")
        full = self._wrap(setup, command)
        proc = subprocess.Popen(
            ["bash", "-c", full],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            start_new_session=True,   # setsid 효과: 새 세션/PGID
        )
        op = OwnedProcess(id=id, machine="server", command=command,
                          pid=proc.pid, pgid=proc.pid, provenance=provenance)
        self.owned[id] = op
        logger.info("spawn_local %s pid=%d", id, proc.pid)
        return op

    def spawn_remote(self, id: str, command: str, machine_key: str = "controller",
                     provenance: str = "baseline") -> OwnedProcess:
        m = self._machine(machine_key)
        inner = self._wrap(m.get("setup", ""), command)
        # setsid(세션 분리) + background, 원격 PID echo. inner는 shlex.quote 로 안전.
        remote = f"setsid bash -c {shlex.quote(inner)} >/tmp/tb_{id}.log 2>&1 & echo $!"
        pid = None
        try:
            r = subprocess.run(self._ssh_base(m) + [remote],
                               capture_output=True, text=True, timeout=15)
            for tok in r.stdout.split():
                if tok.strip().isdigit():
                    pid = int(tok.strip())
                    break
        except Exception as e:
            logger.warning("spawn_remote %s 실패: %s", id, e)
        op = OwnedProcess(id=id, machine=machine_key, command=command,
                          pid=pid, pgid=pid, provenance=provenance)
        self.owned[id] = op
        logger.info("spawn_remote %s pid=%s", id, pid)
        return op

    # ── 종료 (PID/PGID 기반) ──
    def kill(self, id: str) -> None:
        op = self.owned.pop(id, None)
        if not op or op.pid is None:
            return
        if op.machine == "server":
            self._kill_local(op.pid)
        else:
            self._kill_remote(op)

    def _kill_local(self, pid: int) -> None:
        try:
            pgid = os.getpgid(pid)
        except ProcessLookupError:
            return
        try:
            os.killpg(pgid, signal.SIGTERM)
        except ProcessLookupError:
            return
        time.sleep(2)
        try:
            os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass

    def _kill_remote(self, op: OwnedProcess) -> None:
        m = self._machine(op.machine)
        cmd = (f"kill -TERM {op.pid} 2>/dev/null; sleep 2; "
               f"kill -KILL {op.pid} 2>/dev/null || true")
        with __import__("contextlib").suppress(Exception):
            subprocess.run(self._ssh_base(m) + [cmd], capture_output=True, timeout=12)

    def kill_all(self) -> None:
        for id in list(self.owned):
            self.kill(id)

    # ── owned_registry 조회 (boot_gate self-제외, 부속 D §5) ──
    def owned_local_pids(self) -> set[int]:
        """자기가 기동한 local PID + 같은 프로세스 그룹 자식 전체."""
        pids: set[int] = set()
        for op in self.owned.values():
            if op.machine != "server" or not op.pgid:
                continue
            pids.add(op.pid)
            try:
                out = subprocess.run(["pgrep", "-g", str(op.pgid)],
                                     capture_output=True, text=True, timeout=5).stdout
                pids.update(int(x) for x in out.split() if x.isdigit())
            except Exception:
                pass
        return pids

    def status(self) -> list[dict]:
        return [
            {"id": op.id, "machine": op.machine, "pid": op.pid,
             "provenance": op.provenance, "command": op.command}
            for op in self.owned.values()
        ]
