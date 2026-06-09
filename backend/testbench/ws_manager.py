# Copyright 2026 WATT — Apache-2.0
"""WebSocket 연결 관리 — broadcast bus + welcome snapshot.

bt_web_bridge/ws_manager.py 패턴 계승. 재접속 클라이언트는 welcome 스냅샷으로
현재 상태를 복원한다(폴링 불필요). rclpy spin 스레드는 broadcast_threadsafe로
asyncio 루프에 코루틴을 예약한다.

이벤트 envelope: {type, ts, data} (DESIGN v0.3 §7.2).
"""
from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now().astimezone().isoformat()


class WsManager:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._last_snapshot: dict[str, Any] = {
            "active_project": None,
            "boot_state": None,
            "server_started_at": _now_iso(),
        }
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self._connections.add(ws)
        logger.info("ws connected (%d total)", len(self._connections))
        await self._send(ws, "welcome", dict(self._last_snapshot))

    def disconnect(self, ws: WebSocket) -> None:
        self._connections.discard(ws)
        logger.info("ws disconnected (%d remaining)", len(self._connections))

    def update_snapshot(self, **kwargs: Any) -> None:
        """welcome 스냅샷에 필드 병합 (broadcast 안 함)."""
        self._last_snapshot.update(kwargs)

    async def broadcast(self, event_type: str, data: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for ws in list(self._connections):
            try:
                await self._send(ws, event_type, data)
            except Exception as e:
                logger.warning("ws send 실패 → drop: %s", e)
                dead.append(ws)
        for ws in dead:
            self._connections.discard(ws)

    def broadcast_threadsafe(self, event_type: str, data: dict[str, Any]) -> None:
        """비동기 컨텍스트 밖(rclpy spin 스레드)에서 broadcast 예약."""
        if self._loop is None or self._loop.is_closed():
            return
        asyncio.run_coroutine_threadsafe(
            self.broadcast(event_type, data), self._loop,
        )

    async def _send(self, ws: WebSocket, event_type: str, data: dict[str, Any]) -> None:
        envelope = {"type": event_type, "ts": _now_iso(), "data": data}
        await ws.send_text(json.dumps(envelope, default=str))

    @property
    def connection_count(self) -> int:
        return len(self._connections)
