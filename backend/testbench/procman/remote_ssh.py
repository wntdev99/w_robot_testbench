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
import re
import shlex

logger = logging.getLogger("testbench.procman.ssh")


class RemoteRunner:
    def __init__(self, host: str, user: str, setup: str | None = None) -> None:
        self._host = host
        self._user = user
        self._setup = setup or "export LC_ALL=C"
        self._launched: dict[str, dict] = {}   # key -> {command, pidf}

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

    async def ssh_ok(self, timeout: float = 3.0) -> bool:
        """키 기반 SSH 인증·접속이 실제로 되는지(원격 명령 실행 가능 여부)."""
        rc, _ = await self._run("true", timeout=timeout)
        return rc == 0

    async def reachable(self, timeout: float = 3.0) -> bool:
        if await self.ssh_ok(timeout):
            return True
        return await self._ping(timeout)

    async def status(self, timeout: float = 3.0) -> dict:
        """ping 도달과 SSH 인증을 구분해 반환(UI 오해 방지)."""
        ssh = await self.ssh_ok(timeout)
        ping = True if ssh else await self._ping(timeout)
        return {"ping": ping, "ssh": ssh}

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
        """원격 기동. setsid 로 새 세션을 만들고 그 리더 PID(=PGID)를 pidfile 에 기록 →
        종료 시 프로세스 그룹 통째로 시그널해 자식 노드까지 정리한다.
        SSH 인증/연결 실패(rc!=0)면 예외를 던져 호출부(오케스트레이터)가 FAILED 로 노출한다."""
        safe = key.replace(":", "_")
        log = f"/tmp/tb_{safe}.log"
        pidf = f"/tmp/tb_{safe}.pid"
        # bash 가 세션 리더가 되고($$=PGID), pidfile 기록 후 exec 로 command 가 그 PID 승계
        inner = f"{self._setup}; echo $$ > {pidf}; exec {command}"
        full = f"setsid bash -c {shlex.quote(inner)} >{log} 2>&1 </dev/null & disown; echo started"
        rc, _ = await self._run(full, timeout=15.0)
        if rc != 0:
            raise RuntimeError(f"원격 SSH 기동 실패(rc={rc}) — {self._user}@{self._host} 키 인증/연결 확인 (scripts/setup_ssh.sh)")
        self._launched[key] = {"command": command, "pidf": pidf}
        logger.info("원격 기동 [%s]@%s: %s", key, self._host, command)

    async def is_running(self, key: str) -> bool:
        info = self._launched.get(key)
        if not info:
            return False
        rc, out = await self._run(f"pgrep -f {shlex.quote(info['command'])}")
        return bool(out.strip())

    async def stop(self, key: str, grace_s: float = 5.0) -> bool:
        """프로세스 그룹(pidfile) 종료 → grace 후 KILL 에스컬레이션. pidfile 없으면 명령 패턴 폴백.
        반환: 종료 명령이 원격에 정상 전달됐는지(rc==0)."""
        info = self._launched.get(key)
        if not info:
            return True
        pidf, pat = info["pidf"], shlex.quote(info["command"])
        cmd = (
            f'P=$(cat {pidf} 2>/dev/null); '
            f'if [ -n "$P" ]; then kill -INT -"$P" 2>/dev/null; sleep {grace_s}; kill -KILL -"$P" 2>/dev/null; '
            f'else pkill -INT -f {pat}; sleep {grace_s}; pkill -KILL -f {pat}; fi; '
            f'rm -f {pidf}; true'
        )
        rc, _ = await self._run(cmd, timeout=grace_s + 10)
        self._launched.pop(key, None)
        logger.info("원격 종료 [%s] rc=%s", key, rc)
        return rc == 0

    async def kill_ros2(self) -> dict:
        """원격(201)의 ros2 프로세스 일괄 종료 + 검증 루프.

        1) 명시 패턴 SIGINT(정상 종료 유도) + `ros2 daemon stop`
        2) 1.5초 후 명시 패턴 + 실행경로(/opt/ros/<d>/lib, colcon_ws/install/lib) SIGKILL
        3) 광역 잔존 스윕: ROS 로 식별되는 PID 중 '우리 셸의 조상'을 뺀 것들을 직접 kill -9
        4) 남은 개수를 TB_REMAIN 으로 보고(권한/defunct 등 패턴이 못 잡은 예외 가시화)

        bracket 트릭([r]/[o]/[c]·[-][-])으로 pkill 자기 매칭 회피, 경로는 '/lib/' 로 좁혀
        현재 셸이 source 한 setup.bash(=/opt/ros/.../setup.bash, install/setup.bash) 와의 매칭을 피한다.
        반환: {ok: ssh 전달 성공(rc==0), remaining: 스윕 후 잔존 개수|None}."""
        expl = ["[r]os2 launch", "[r]os2 run", "rmw_[z]enohd", "ros2_[c]ontrol",
                "[r]obot_state_publisher", "[-][-]ros-args"]
        paths = ["/[o]pt/ros/[^/]*/lib/", "[c]olcon_ws/install/lib/"]
        intc = "; ".join(f"pkill -INT -f '{p}'" for p in expl)
        killc = "; ".join(f"pkill -KILL -f '{p}'" for p in expl + paths)
        # ROS 식별 광역 패턴(잔존 스윕용) — 노드 실행경로/인자/데몬/컨테이너까지
        broad = "/opt/ros/[^/]+/lib/|colcon_ws/install/lib/|--ros-args|rmw_zenohd|ros2cli|component_container"
        sweep = (
            'ME=$$; ANC=" $ME "; A=$ME; '
            'for i in 1 2 3 4 5 6; do A=$(ps -o ppid= -p "$A" 2>/dev/null | tr -d " "); [ -z "$A" ] && break; ANC="$ANC$A "; done; '
            f"BROAD='{broad}'; "
            'for p in $(pgrep -f "$BROAD" 2>/dev/null); do case "$ANC" in *" $p "*) : ;; *) kill -9 "$p" 2>/dev/null ;; esac; done; '
            'sleep 0.3; LEFT=0; for p in $(pgrep -f "$BROAD" 2>/dev/null); do case "$ANC" in *" $p "*) : ;; *) LEFT=$((LEFT+1)) ;; esac; done; '
            'echo "TB_REMAIN=$LEFT"; true'
        )
        script = (f"{self._setup}; {intc}; ros2 daemon stop >/dev/null 2>&1 || true; "
                  f"sleep 1.5; {killc}; {sweep}")
        rc, out = await self._run(script, timeout=20)
        m = re.search(r"TB_REMAIN=(\d+)", out or "")
        remaining = int(m.group(1)) if m else None
        logger.info("원격 ros2 종료 @%s rc=%s 잔존=%s", self._host, rc, remaining)
        return {"ok": rc == 0, "remaining": remaining}

    async def stop_all(self) -> None:
        for key in list(self._launched.keys()):
            await self.stop(key)

    async def close(self) -> None:
        pass
