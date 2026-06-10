# Copyright 2026 WATT — Apache-2.0
"""난입(foreign) 감지 monitor — 주기적으로 owned-registry 차집합 스캔 (부속 D §2.6/§5).

Clean-Slate 부팅 이후, 기동 레지스트리에 없는데 살아있는 ROS 프로세스 = 외부 난입.
boot_gate.scan()이 owned_local_pids + getpid/getppid 를 제외하므로 차집합이 곧 난입.
감지 시 ws 로 경고(자동 종료 안 함 — 사용자 승인 필요, 불변식 부속 D §5).
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


async def intrusion_monitor(boot_gate, ws, interval: float = 30.0) -> None:
    while True:
        await asyncio.sleep(interval)
        try:
            scan = boot_gate.scan()
            n = len(scan.get("server", [])) + len(scan.get("controller", []))
            if n:
                logger.warning("난입 ROS 프로세스 %d개 감지(레지스트리 외)", n)
                await ws.broadcast("intrusion", {"found": n, "scan": scan})
        except Exception as e:  # pragma: no cover
            logger.warning("intrusion monitor 오류: %s", e)
