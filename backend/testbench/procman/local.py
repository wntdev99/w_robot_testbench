"""로컬(서버=202) 프로세스 실행기 — asyncio subprocess + 프로세스 그룹 시그널."""
from __future__ import annotations

import asyncio
import logging
import os
import signal

logger = logging.getLogger("testbench.procman.local")


class LocalRunner:
    def __init__(self, setup: str | None = None) -> None:
        # 서버 머신 ROS 환경 prefix (systemd/개발셸이 이미 source 했다면 빈 값 가능)
        self._setup = setup
        self._procs: dict[str, asyncio.subprocess.Process] = {}

    def _wrap(self, command: str) -> str:
        return f"{self._setup}; exec {command}" if self._setup else f"exec {command}"

    async def start(self, key: str, command: str) -> int:
        proc = await asyncio.create_subprocess_shell(
            self._wrap(command),
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL,
            start_new_session=True,   # 자체 프로세스 그룹 → killpg 가능
            executable="/bin/bash",
        )
        self._procs[key] = proc
        logger.info("로컬 기동 [%s] pid=%s: %s", key, proc.pid, command)
        return proc.pid

    def is_running(self, key: str) -> bool:
        proc = self._procs.get(key)
        return proc is not None and proc.returncode is None

    async def stop(self, key: str, grace_s: float = 5.0) -> None:
        proc = self._procs.get(key)
        if proc is None or proc.returncode is not None:
            return
        try:
            pgid = os.getpgid(proc.pid)
            os.killpg(pgid, signal.SIGINT)        # ros2 launch 는 SIGINT 로 정상 종료
            try:
                await asyncio.wait_for(proc.wait(), timeout=grace_s)
            except asyncio.TimeoutError:
                os.killpg(pgid, signal.SIGTERM)
                try:
                    await asyncio.wait_for(proc.wait(), timeout=3.0)
                except asyncio.TimeoutError:
                    os.killpg(pgid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        finally:
            self._procs.pop(key, None)
            logger.info("로컬 종료 [%s]", key)

    async def stop_all(self) -> None:
        for key in list(self._procs.keys()):
            await self.stop(key)
