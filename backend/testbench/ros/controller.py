# Copyright 2026 WATT — Apache-2.0
"""controller_manager 연동 — list/switch (DESIGN v0.3 §7.1).

controller_manager_msgs service 로 컨트롤러 목록 조회·활성/비활성 전환.
service future 는 ros_bridge.await_ros_future 로 asyncio 래핑.
"""
from __future__ import annotations

import logging

from controller_manager_msgs.srv import ListControllers, SwitchController

from testbench.ros_bridge import await_ros_future

logger = logging.getLogger(__name__)


class ControllerManager:
    def __init__(self, node) -> None:
        self.node = node
        self._list = node.create_client(ListControllers, "/controller_manager/list_controllers")
        self._switch = node.create_client(SwitchController, "/controller_manager/switch_controller")

    async def list(self) -> dict:
        if not self._list.wait_for_service(timeout_sec=3.0):
            return {"available": False, "controllers": []}
        resp = await await_ros_future(self._list.call_async(ListControllers.Request()))
        return {
            "available": True,
            "controllers": [
                {"name": c.name, "state": c.state, "type": c.type} for c in resp.controller
            ],
        }

    async def switch(self, activate: list[str], deactivate: list[str],
                     strictness: int = 1) -> dict:
        if not self._switch.wait_for_service(timeout_sec=3.0):
            return {"ok": False, "error": "service unavailable"}
        req = SwitchController.Request()
        req.activate_controllers = activate or []
        req.deactivate_controllers = deactivate or []
        req.strictness = strictness
        resp = await await_ros_future(self._switch.call_async(req))
        return {"ok": bool(resp.ok)}
