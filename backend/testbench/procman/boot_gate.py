# Copyright 2026 WATT — Apache-2.0
"""Clean-Slate 부팅 게이트 (DESIGN 부속 D §2.5, 2026-06-09 실증).

서버 = 모든 ROS 프로세스의 유일한 기동 게이트웨이. 부팅 시 이미 떠 있는
ROS 프로세스를 스캔 → 사용자 결정(취소=기동거부 / 종료=정리 후 기동).

검증된 원칙:
  - 식별: cmdline 패턴 (부속 D §2.6). self-match 방지 위해 자기 PID 제외.
  - 종료: PID 기반 SIGTERM→SIGKILL. `pkill -f` 금지(오살 위험 실측).
  - 원격(201)은 SSH로 동일 수행.
"""
from __future__ import annotations

import logging
import os
import signal
import subprocess
import time

logger = logging.getLogger(__name__)


def _ssh_base(user: str, host: str) -> list[str]:
    return ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=8", f"{user}@{host}"]


class BootGate:
    def __init__(self, config, process_manager=None) -> None:
        self.cfg = config
        self.pm = process_manager   # owned_registry self-제외 (부속 D §5)

    @property
    def _pattern(self) -> str:
        # pgrep -f 용 ERE OR 패턴
        return "|".join(self.cfg.ros_proc_patterns) or "rmw_zenohd"

    # ── 스캔 ──
    def _scan_local(self) -> list[dict]:
        try:
            out = subprocess.run(
                ["pgrep", "-af", self._pattern],
                capture_output=True, text=True, timeout=10,
            ).stdout
        except Exception as e:
            logger.warning("local scan 실패: %s", e)
            return []
        # self-제외: 백엔드 자신(getpid) + ros2 run wrapper(getppid) + owned 프로세스 트리
        exclude = {os.getpid(), os.getppid()}
        if self.pm is not None:
            exclude |= self.pm.owned_local_pids()
        return self._parse(out, exclude=exclude)

    def _scan_remote(self) -> list[dict]:
        ctrl = self.cfg.machines.get("controller", {})
        host, user = ctrl.get("host"), ctrl.get("ssh_user")
        if not host or not user:
            return []
        try:
            out = subprocess.run(
                _ssh_base(user, host) + [f"pgrep -af '{self._pattern}'"],
                capture_output=True, text=True, timeout=12,
            ).stdout
        except Exception as e:
            logger.warning("remote(201) scan 실패: %s", e)
            return []
        return self._parse(out)

    @staticmethod
    def _parse(out: str, exclude: set[int] | None = None) -> list[dict]:
        exclude = exclude or set()
        procs = []
        for line in out.strip().splitlines():
            parts = line.split(maxsplit=1)
            if len(parts) != 2 or not parts[0].isdigit():
                continue
            pid = int(parts[0])
            if pid in exclude:
                continue
            if "pgrep" in parts[1]:  # self-match 방지
                continue
            procs.append({"pid": pid, "cmd": parts[1]})
        return procs

    def scan(self) -> dict:
        """{server: [...], controller: [...]} — 관리되지 않는 기존 ROS 프로세스."""
        return {"server": self._scan_local(), "controller": self._scan_remote()}

    # ── 종료 (PID 기반, SIGTERM→SIGKILL) ──
    def kill_local(self, pids: list[int]) -> None:
        for pid in pids:
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
        time.sleep(3)
        for pid in pids:
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass

    def kill_remote(self, pids: list[int]) -> None:
        if not pids:
            return
        ctrl = self.cfg.machines.get("controller", {})
        host, user = ctrl.get("host"), ctrl.get("ssh_user")
        if not host or not user:
            return
        pid_args = " ".join(str(p) for p in pids)
        cmd = f"kill -TERM {pid_args}; sleep 3; kill -KILL {pid_args} 2>/dev/null || true"
        subprocess.run(_ssh_base(user, host) + [cmd], capture_output=True, timeout=15)

    def resolve(self, action: str, scan: dict) -> dict:
        """action: kill | cancel. cancel 시 호출측이 서버 기동을 거부."""
        if action == "kill":
            self.kill_local([p["pid"] for p in scan.get("server", [])])
            self.kill_remote([p["pid"] for p in scan.get("controller", [])])
            return {"action": "kill", "killed": True}
        return {"action": "cancel", "killed": False}
