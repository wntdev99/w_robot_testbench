"""전역 Emergency Stop (DESIGN.md §10 / 역량 L).

cmd_vel 0 발행 + 활성 컨트롤러 비활성 + estop 이벤트 브로드캐스트.
모바일 베이스: /swerve_controller/cmd_vel 에 zero Twist.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, Request

logger = logging.getLogger("testbench.api.emergency")
router = APIRouter(prefix="/api/emergency", tags=["safety"])

ZERO_TWIST = {"linear": {"x": 0.0, "y": 0.0, "z": 0.0},
              "angular": {"x": 0.0, "y": 0.0, "z": 0.0}}


@router.post("/stop")
async def estop(request: Request):
    ctx = request.app.state.ctx
    result = {"cmd_vel_zeroed": False, "deactivated": []}
    try:
        ctx.ros.publish_once("/swerve_controller/cmd_vel", "geometry_msgs/msg/Twist", ZERO_TWIST)
        result["cmd_vel_zeroed"] = True
    except Exception as e:  # noqa: BLE001
        logger.warning("estop cmd_vel 실패: %s", e)
    try:
        ctrls = ctx.ros.list_controllers()
        active = [c["name"] for c in ctrls if c.get("state") == "active"
                  and c["name"] != "joint_state_broadcaster"]
        if active:
            ctx.ros.switch_controller([], active)
            result["deactivated"] = active
    except Exception as e:  # noqa: BLE001
        logger.warning("estop 컨트롤러 비활성 실패: %s", e)
    await ctx.ws.broadcast("estop", result, snapshot=True)
    logger.warning("EMERGENCY STOP 실행: %s", result)
    return result
