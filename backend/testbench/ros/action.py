# Copyright 2026 WATT — Apache-2.0
"""동적 action goal 전송 (L4). control.action 위젯이 런타임 타입으로 호출."""
from __future__ import annotations

import logging

from rclpy.action import ActionClient
from rosidl_runtime_py.convert import message_to_ordereddict
from rosidl_runtime_py.set_message import set_message_fields
from rosidl_runtime_py.utilities import get_action

from testbench.ros_bridge import await_ros_future

logger = logging.getLogger(__name__)


class ActionCaller:
    def __init__(self, node) -> None:
        self.node = node
        self._clients: dict = {}

    async def send_goal(self, name: str, action_type: str, goal_values: dict | None = None) -> dict:
        key = (name, action_type)
        cli = self._clients.get(key)
        if cli is None:
            cli = ActionClient(self.node, get_action(action_type), name)
            self._clients[key] = cli
        if not cli.wait_for_server(timeout_sec=3.0):
            return {"ok": False, "error": f"action server unavailable: {name}"}
        goal = get_action(action_type).Goal()
        if goal_values:
            set_message_fields(goal, goal_values)
        handle = await await_ros_future(cli.send_goal_async(goal))
        if not handle.accepted:
            return {"ok": False, "error": "goal rejected"}
        wrapped = await await_ros_future(handle.get_result_async())
        return {"ok": True, "result": message_to_ordereddict(wrapped.result)}


def action_goal_fields(action_type: str) -> dict:
    from testbench.api.introspect import _fields_of_type
    return _fields_of_type(get_action(action_type).Goal)
