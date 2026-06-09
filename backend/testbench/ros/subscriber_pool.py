# Copyright 2026 WATT — Apache-2.0
"""subscriber_pool — 동적 토픽 구독 → WS 스트림 (L3, DESIGN v0.3 §4.2).

위젯 plot.topic/diagnostics/state 가 WS `{op:sub, topic}` 요청 → 런타임 타입 발견
→ rclpy 구독 → 직렬화 → throttle 후 ws broadcast (envelope type="topic").
콜백은 executor 스레드에서 실행되므로 ws.broadcast_threadsafe 사용.
"""
from __future__ import annotations

import logging
import time

from rosidl_runtime_py.convert import message_to_ordereddict
from rosidl_runtime_py.utilities import get_message

logger = logging.getLogger(__name__)


class SubscriberPool:
    def __init__(self, node, ws, throttle_hz: float = 10.0) -> None:
        self.node = node
        self.ws = ws
        self.throttle_s = 1.0 / throttle_hz
        self._subs: dict = {}
        self._last: dict[str, float] = {}

    def subscribe(self, topic: str) -> dict:
        if topic in self._subs:
            return {"topic": topic, "status": "already"}
        types = dict(self.node.get_topic_names_and_types()).get(topic)
        if not types:
            return {"topic": topic, "status": "no_type"}  # 아직 미발행 → 클라가 재시도
        try:
            msg_type = get_message(types[0])
        except Exception as e:
            return {"topic": topic, "status": "type_err", "error": str(e)}
        sub = self.node.create_subscription(
            msg_type, topic, lambda m, t=topic: self._cb(t, m), 10,
        )
        self._subs[topic] = sub
        logger.info("subscribe %s (%s)", topic, types[0])
        return {"topic": topic, "status": "subscribed", "type": types[0]}

    def _cb(self, topic: str, msg) -> None:
        now = time.monotonic()
        if now - self._last.get(topic, 0.0) < self.throttle_s:
            return  # downsample
        self._last[topic] = now
        try:
            values = message_to_ordereddict(msg)
        except Exception as e:
            logger.warning("직렬화 실패 %s: %s", topic, e)
            return
        self.ws.broadcast_threadsafe("topic", {"topic": topic, "values": values})

    def unsubscribe(self, topic: str) -> dict:
        sub = self._subs.pop(topic, None)
        if sub is not None:
            self.node.destroy_subscription(sub)
        self._last.pop(topic, None)
        return {"topic": topic, "status": "unsubscribed"}

    def active(self) -> list[str]:
        return list(self._subs)
