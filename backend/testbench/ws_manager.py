"""WebSocket 연결 관리 — broadcast 버스 + welcome 스냅샷.

bt_web_bridge/ws_manager 패턴 계승. 연결은 모든 이벤트를 구독한다.
rclpy spin 스레드는 `broadcast_threadsafe` 로만 진입 → asyncio 루프에 코루틴 스케줄.
이벤트 envelope: {"type": <event>, "ts": <iso>, "data": {...}}.
"""
from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger("testbench.ws")


def _now() -> float:
    return time.time()


class WsManager:
    def __init__(self) -> None:
        self._conns: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        # 최신 스냅샷 (재접속 복원용) — event type 별 마지막 data
        self._snapshot: dict[str, Any] = {}

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._conns.add(ws)
        # welcome: 현재 스냅샷 전달
        await self._send(ws, {"type": "welcome", "ts": _now(), "data": dict(self._snapshot)})
        logger.info("WS 연결 (%d개)", len(self._conns))

    def disconnect(self, ws: WebSocket) -> None:
        self._conns.discard(ws)
        logger.info("WS 해제 (%d개)", len(self._conns))

    async def _send(self, ws: WebSocket, payload: dict[str, Any]) -> None:
        try:
            await ws.send_text(json.dumps(payload, default=str))
        except Exception:  # noqa: BLE001 — 끊긴 연결 정리
            self._conns.discard(ws)

    async def broadcast(self, event: str, data: Any, *, snapshot: bool = False) -> None:
        payload = {"type": event, "ts": _now(), "data": data}
        if snapshot:
            self._snapshot[event] = data
        dead: list[WebSocket] = []
        for ws in list(self._conns):
            try:
                await ws.send_text(json.dumps(payload, default=str))
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self._conns.discard(ws)

    def broadcast_threadsafe(self, event: str, data: Any, *, snapshot: bool = False) -> None:
        """rclpy spin 스레드 등 비-asyncio 컨텍스트에서 호출."""
        if self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self.broadcast(event, data, snapshot=snapshot), self._loop
        )
