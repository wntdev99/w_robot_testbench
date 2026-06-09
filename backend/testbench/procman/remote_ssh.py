"""원격(컨트롤러=201) SSH 실행기 — 시스템 ssh 바이너리(subprocess) 사용.

asyncssh 같은 pip 의존성 없이 키 기반 ssh 로 동작 (dev·202 공통).
런치 기동: `<setup>; setsid nohup <command> &`.
종료: 명령 패턴으로 `pkill -INT -f`.
연결성: `ssh ... true` (실패 시 ping fallback).

⚠ 모터 전원 인가가 수반되는 control.launch.py 기동은 라이브 환경에서 검증 필요.
"""
from __future__ import annotations

import asyncio
import logging
import shlex

logger = logging.getLogger("testbench.procman.ssh")


class RemoteRunner:
    def __init__(self, host: str, user: str, setup: str | None = None) -> None:
        self._host = host
        self._user = user
        self._setup = setup or "export LC_ALL=C"
        self._launched: dict[str, str] = {}   # key -> command(pattern)

    def _ssh(self, remote_cmd: str) -> list[str]:
        return [
            "ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=5",
            "-o", "StrictHostKeyChecking=accept-new",
            f"{self._user}@{self._host}", remote_cmd,
        ]

    async def _run(self, remote_cmd: str, timeout: float = 15.0) -> tuple[int, str]:
        try:
            proc = await asyncio.create_subprocess_exec(
                *self._ssh(remote_cmd),
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
            )
            out, _ = await asyncio.wait_for(proc.communicate(), timeout=timeout)
            return proc.returncode or 0, out.decode(errors="ignore")
        except Exception as exc:  # noqa: BLE001
            logger.warning("ssh 실행 실패: %s", exc)
            return 1, ""

    async def reachable(self, timeout: float = 3.0) -> bool:
        rc, _ = await self._run("true", timeout=timeout)
        if rc == 0:
            return True
        return await self._ping(timeout)

    async def _ping(self, timeout: float) -> bool:
        try:
            proc = await asyncio.create_subprocess_exec(
                "ping", "-c", "1", "-W", str(int(timeout)), self._host,
                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
            )
            return (await proc.wait()) == 0
        except Exception:  # noqa: BLE001
            return False

    async def run_capture(self, command: str, timeout: float = 15.0) -> str:
        _, out = await self._run(f"{self._setup}; {command}", timeout=timeout)
        return out

    async def start(self, key: str, command: str) -> None:
        log = f"/tmp/tb_{key.replace(':', '_')}.log"
        full = f"{self._setup}; setsid nohup {command} >{log} 2>&1 </dev/null & echo started"
        await self._run(full, timeout=15.0)
        self._launched[key] = command
        logger.info("원격 기동 [%s]@%s: %s", key, self._host, command)

    async def is_running(self, key: str) -> bool:
        command = self._launched.get(key)
        if not command:
            return False
        rc, out = await self._run(f"pgrep -f {shlex.quote(command)}")
        return bool(out.strip())

    async def stop(self, key: str, grace_s: float = 5.0) -> None:
        command = self._launched.get(key)
        if not command:
            return
        pat = shlex.quote(command)
        await self._run(f"pkill -INT -f {pat}")
        await asyncio.sleep(grace_s)
        await self._run(f"pkill -TERM -f {pat}")
        self._launched.pop(key, None)
        logger.info("원격 종료 [%s]", key)

    async def stop_all(self) -> None:
        for key in list(self._launched.keys()):
            await self.stop(key)

    async def close(self) -> None:
        pass
