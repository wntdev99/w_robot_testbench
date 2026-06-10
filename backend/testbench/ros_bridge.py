# Copyright 2026 WATT — Apache-2.0
"""ROS2 브리지 — rclpy Node + 런타임 introspect 헬퍼.

bt_web_bridge/ros_bridge.py 패턴 계승. 단 testbench는 BehaviorTree 액션에
묶이지 않는다(부속 A 결정). 대신 토픽/타입/서비스/액션을 **런타임 동적 발견**하고
(위젯 동적폼·preflight 입력), service/action future를 asyncio로 래핑한다.

rclpy spin 은 main.py 가 띄운 백그라운드 executor 스레드가 담당.
"""
from __future__ import annotations

import asyncio
import logging
from typing import Any

from rclpy.node import Node
from rclpy.task import Future as RosFuture

logger = logging.getLogger(__name__)


class RosBridge(Node):
    """introspect 중심 브리지 노드. (이름은 기존 /w_robot_testbench 와 구분)"""

    def __init__(self, node_name: str = "testbench_bridge") -> None:
        super().__init__(node_name)

    # ── 런타임 발견 (위젯 동적폼·preflight 입력) ──
    def list_nodes(self) -> list[str]:
        return sorted(
            f"{ns.rstrip('/')}/{name}" if ns != "/" else f"/{name}"
            for name, ns in self.get_node_names_and_namespaces()
        )

    def list_topics(self) -> dict[str, list[str]]:
        return {name: types for name, types in self.get_topic_names_and_types()}

    def list_services(self) -> dict[str, list[str]]:
        return {name: types for name, types in self.get_service_names_and_types()}

    def topic_type(self, name: str) -> str | None:
        for tname, types in self.get_topic_names_and_types():
            if tname == name and types:
                return types[0]
        return None

    # ── healthcheck 보조 (baseline/preflight) ──
    def node_exists(self, node_name: str) -> bool:
        return node_name in self.list_nodes()

    def topic_exists(self, topic: str) -> bool:
        return any(t == topic for t in self.list_topics())

    def publisher_count(self, topic: str) -> int:
        # 발행자 존재 = 데이터가 흐를 준비 (preflight 발행 검증, rate 근사)
        try:
            return self.count_publishers(topic)
        except Exception:
            return 0


async def await_ros_future(future: RosFuture, poll_interval: float = 0.05) -> Any:
    """rclpy.task.Future 를 asyncio 에서 await (background 스레드가 spin)."""
    while not future.done():
        await asyncio.sleep(poll_interval)
    exc = future.exception()
    if exc is not None:
        raise exc
    return future.result()
