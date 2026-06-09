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

    def estop(self) -> dict:
        logger.warning("E-STOP triggered (P0 stub — cmd_vel 0 / goal cancel 미구현)")
        # TODO(P2): cmd_vel 0 publish, 활성 액추에이터 정지, active goal cancel
        return {
            "estopped": True,
            "note": "P0 stub: 프로세스 kill 아님(L1). 실제 정지 로직 P2~P3.",
        }
