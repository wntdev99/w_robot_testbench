"""zenoh 라우터(rmw_zenohd) 상태 감시 + 기동.

상태 판정(주): 라우터 TCP 엔드포인트(host:port) 연결 가능 여부 — 백엔드가 어느
머신에 있든 라우터 위치(보통 서버 202)를 본다.
상태 판정(보조): psutil 로 로컬 프로세스 탐색(엔드포인트 프로브가 막힌 경우 대비).
이미 떠 있으면(외부/이전 실행) 기동 생략(skip_if_running).
"""
from __future__ import annotations

import logging
import socket

import psutil

from .local import LocalRunner

logger = logging.getLogger("testbench.procman.zenoh")


class ZenohManager:
    def __init__(self, router_cmd: str, process_match: str, runner: LocalRunner,
                 host: str = "127.0.0.1", port: int = 7447) -> None:
        self._cmd = router_cmd
        self._match = process_match
        self._runner = runner
        self._host = host
        self._port = int(port)
        self._started_by_us = False

    def _endpoint_open(self) -> bool:
        try:
            with socket.create_connection((self._host, self._port), timeout=0.5):
                return True
        except OSError:
            return False

    def _local_process(self) -> bool:
        for proc in psutil.process_iter(["name", "cmdline"]):
            try:
                cmd = " ".join(proc.info.get("cmdline") or [])
                if self._match in cmd or self._match == (proc.info.get("name") or ""):
                    return True
            except (psutil.NoSuchProcess, psutil.AccessDenied):
                continue
        return False

    def is_running(self) -> bool:
        return self._endpoint_open() or self._local_process()

    async def ensure_running(self, key: str = "_autostart:zenoh_router") -> dict:
        if self.is_running():
            logger.info("zenoh 라우터 이미 실행 중 — 기동 생략")
            return {"running": True, "started_by_us": False}
        pid = await self._runner.start(key, self._cmd)
        self._started_by_us = True
        logger.info("zenoh 라우터 기동 pid=%s", pid)
        return {"running": True, "started_by_us": True, "pid": pid}

    def status(self) -> dict:
        endpoint = self._endpoint_open()
        return {
            "running": endpoint or self._local_process(),
            "endpoint_open": endpoint,
            "router": f"{self._host}:{self._port}",
            "started_by_us": self._started_by_us,
        }
