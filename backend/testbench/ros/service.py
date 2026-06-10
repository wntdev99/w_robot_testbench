# Copyright 2026 WATT — Apache-2.0
"""동적 service/action 호출 (L4, DESIGN v0.3 §7.1).

control.service / control.action 위젯이 런타임 타입으로 호출. future→asyncio 래핑.
"""
from __future__ import annotations

import logging

from rosidl_runtime_py.convert import message_to_ordereddict
from rosidl_runtime_py.set_message import set_message_fields
from rosidl_runtime_py.utilities import get_service

from testbench.ros_bridge import await_ros_future

logger = logging.getLogger(__name__)


class ServiceCaller:
    def __init__(self, node) -> None:
        self.node = node
        self._clients: dict = {}

    async def call(self, name: str, srv_type: str, values: dict | None = None) -> dict:
        key = (name, srv_type)
        cli = self._clients.get(key)
        if cli is None:
            cli = self.node.create_client(get_service(srv_type), name)
            self._clients[key] = cli
        if not cli.wait_for_service(timeout_sec=3.0):
            return {"ok": False, "error": f"service unavailable: {name}"}
        req = get_service(srv_type).Request()
        if values:
            set_message_fields(req, values)
        resp = await await_ros_future(cli.call_async(req))
        return {"ok": True, "response": message_to_ordereddict(resp)}


def service_request_fields(srv_type: str) -> dict:
    """srv Request 필드 트리 (control.service 동적폼). msg _fields 와 동일 형식."""
    from testbench.api.introspect import _fields_of_type
    return _fields_of_type(get_service(srv_type).Request)
