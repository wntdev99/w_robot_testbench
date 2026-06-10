# Copyright 2026 WATT — Apache-2.0
"""전역 Emergency Stop (DESIGN v0.3 §10, L1).

불변식(부속 D §4): E-stop ≠ 프로세스 kill. 모터·액추에이터를 멈출 뿐
baseline·실행 프로세스를 종료하지 않는다(프로세스 종료는 reconciler 책임).

P0: 인터페이스 stub. 실제 cmd_vel 0 publish + 다중 액추에이터 정지 + active
goal cancel 은 P2~P3 에서 RosBridge publisher/ActionClient 와 함께 구현.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class Emergency:
    def __init__(self, bridge) -> None:
        self.bridge = bridge

    def estop(self, bridge=None, publisher_pool=None) -> dict:
        """cmd_vel 류 토픽에 0 Twist 발행 (L1). 프로세스 kill 아님(부속 D §4)."""
        bridge = bridge or self.bridge
        logger.warning("E-STOP triggered — cmd_vel 0 발행")
        stopped: list[str] = []
        if publisher_pool is not None and bridge is not None:
            for topic, types in bridge.list_topics().items():
                if "cmd_vel" in topic and any("Twist" in t for t in types):
                    try:
                        publisher_pool.publish(topic, types[0], {})  # 0 Twist
                        stopped.append(topic)
                    except Exception as e:
                        logger.warning("estop publish %s 실패: %s", topic, e)
        return {
            "estopped": True,
            "cmd_vel_zeroed": stopped,
            "note": "cmd_vel 0 발행(L1). 프로세스 kill 아님. 액추에이터·goal cancel은 P3.",
        }
