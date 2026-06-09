"""원격(컨트롤러=201) SSH 런치 실행기 — asyncssh.

런치 기동: `<setup>; exec <command>` 를 SSH 로 백그라운드 실행.
종료: 명령 패턴으로 `pkill -INT -f` (ros2 launch 정상 종료).
연결성: ping/SSH 접속 가능 여부 → "단독 vs 함께" 판정에 사용.

⚠ 모터 전원 인가가 수반되는 control.launch.py 기동은 라이브 환경에서 검증 필요.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger("testbench.procman.ssh")

try:
    import asyncssh
except ImportError:  # 개발 편의 — asyncssh 미설치 시에도 import 가능
    asyncssh = None  # type: ignore


class RemoteRunner:
    def __init__(self, host: str, user: str, setup: str | None = None) -> None:
        self._host = host
        self._user = user
        self._setup = setup or "export LC_ALL=C"
        self._conn: "asyncssh.SSHClientConnection | None" = None
        self._launched: dict[str, str] = {}   # key -> command(pattern)

    async def _ensure_conn(self) -> "asyncssh.SSHClientConnection":
        if asyncssh is None:
            raise RuntimeError("asyncssh 미설치 — pip install asyncssh")
        if self._conn is None:
            self._conn = await asyncssh.connect(
                self._host, username=self._user, known_hosts=None
            )
        return self._conn

    async def reachable(self, timeout: float = 3.0) -> bool:
        """SSH 접속 가능 여부 (201 연결/함께 판정)."""
        if asyncssh is None:
            return await self._ping(timeout)
        try:
            conn = await asyncio.wait_for(self._ensure_conn(), timeout=timeout)
            res = await asyncio.wait_for(conn.run("true"), timeout=timeout)
            return res.exit_status == 0
        except Exception:  # noqa: BLE001
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

    async def start(self, key: str, command: str) -> None:
        conn = await self._ensure_conn()
        # nohup + setsid 로 세션 분리 백그라운드 기동
        full = f"{self._setup}; setsid nohup {command} >/tmp/tb_{key.replace(':','_')}.log 2>&1 &"
        await conn.run(full, check=False)
        self._launched[key] = command
        logger.info("원격 기동 [%s]@%s: %s", key, self._host, command)

    async def is_running(self, key: str) -> bool:
        command = self._launched.get(key)
        if not command:
            return False
        try:
            conn = await self._ensure_conn()
            res = await conn.run(f"pgrep -f {asyncssh.escape_arg(command)}", check=False)  # type: ignore
            return bool((res.stdout or "").strip())
        except Exception:  # noqa: BLE001
            return False

    async def stop(self, key: str, grace_s: float = 5.0) -> None:
        command = self._launched.get(key)
        if not command:
            return
        try:
            conn = await self._ensure_conn()
            pat = asyncssh.escape_arg(command)  # type: ignore
            await conn.run(f"pkill -INT -f {pat}", check=False)
            await asyncio.sleep(grace_s)
            await conn.run(f"pkill -TERM -f {pat}", check=False)
        except Exception as exc:  # noqa: BLE001
            logger.warning("원격 종료 실패 [%s]: %s", key, exc)
        finally:
            self._launched.pop(key, None)
            logger.info("원격 종료 [%s]", key)

    async def stop_all(self) -> None:
        for key in list(self._launched.keys()):
            await self.stop(key)

    async def close(self) -> None:
        if self._conn is not None:
            self._conn.close()
            self._conn = None
