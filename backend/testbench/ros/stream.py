"""스트림 허브 — 동적 토픽 구독 + throttle + WS 브로드캐스트.

ros_bridge 의 spin 스레드에서 콜백이 호출되므로 broadcast_threadsafe 로 asyncio 에 넘긴다.
토픽당 ref-count: 마지막 구독자가 빠지면 실제 구독 해제.
diagnostics 는 ros_bridge 가 상시 구독 → 여기서 WS 로 중계.
"""
from __future__ import annotations

import logging
import time

from ..ros_bridge import RosBridge
from ..ws_manager import WsManager

logger = logging.getLogger("testbench.ros.stream")


class StreamHub:
    def __init__(self, ros: RosBridge, ws: WsManager, default_rate_hz: float = 20.0) -> None:
        self._ros = ros
        self._ws = ws
        self._min_interval = 1.0 / max(default_rate_hz, 1.0)
        self._refcount: dict[str, int] = {}
        self._last_emit: dict[str, float] = {}
        # diagnostics 중계 연결
        self._ros.set_diagnostics_callback(self._on_diag)
        self._diag_last = 0.0

    def subscribe(self, topic: str, type_str: str | None = None) -> bool:
        self._refcount[topic] = self._refcount.get(topic, 0) + 1
        if self._refcount[topic] > 1:
            return True

        def _cb(data: dict, _topic: str = topic) -> None:
            now = time.time()
            if now - self._last_emit.get(_topic, 0.0) < self._min_interval:
                return
            self._last_emit[_topic] = now
            self._ws.broadcast_threadsafe("topic_data", {"topic": _topic, "values": data})

        ok = self._ros.subscribe(topic, type_str, _cb)
        if not ok:
            self._refcount.pop(topic, None)
        return ok

    def unsubscribe(self, topic: str) -> None:
        n = self._refcount.get(topic, 0) - 1
        if n <= 0:
            self._refcount.pop(topic, None)
            self._ros.unsubscribe(topic)
        else:
            self._refcount[topic] = n

    def _on_diag(self, updated: dict) -> None:
        now = time.time()
        if now - self._diag_last < self._min_interval:
            return
        self._diag_last = now
        self._ws.broadcast_threadsafe("diagnostics", updated, snapshot=True)

    def active_topics(self) -> list[str]:
        return list(self._refcount.keys())
