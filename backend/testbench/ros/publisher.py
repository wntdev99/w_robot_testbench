# Copyright 2026 WATT — Apache-2.0
"""publisher_pool — 동적 토픽 발행 (L4, DESIGN v0.3 §4.2).

control.topic_pub 위젯이 /api/publish 로 {topic, type, values} 전송 → 런타임
타입 로드 → 메시지 조립 → 발행. publisher는 토픽별 재사용.
"""
from __future__ import annotations

import logging

from rosidl_runtime_py.set_message import set_message_fields
from rosidl_runtime_py.utilities import get_message

logger = logging.getLogger(__name__)


class PublisherPool:
    def __init__(self, node) -> None:
        self.node = node
        self._pubs: dict = {}

    def publish(self, topic: str, type_str: str, values: dict | None = None) -> dict:
        if topic in self._pubs:
            pub, msg_type = self._pubs[topic]
        else:
            msg_type = get_message(type_str)
            pub = self.node.create_publisher(msg_type, topic, 10)
            self._pubs[topic] = (pub, msg_type)
            logger.info("publisher 생성 %s (%s)", topic, type_str)
        msg = msg_type()
        if values:
            set_message_fields(msg, values)
        pub.publish(msg)
        return {"topic": topic, "type": type_str, "published": True}
