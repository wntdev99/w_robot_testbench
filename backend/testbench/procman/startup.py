"""서버 기동 시작 플랜 — 관리자 탭에서 편집(순서/간격/대상), config/startup.json 영속.

서버가 켜지면(또는 관리자에서 '적용'): kill_on_start 면 기존 ros2 종료 →
steps 를 순서대로(각 delay_s 대기) 기동. zenoh 는 kind=zenoh(있으면 생략).
"""
from __future__ import annotations

import json
import logging

from ..config import CONFIG_DIR

logger = logging.getLogger("testbench.startup")

PLAN_PATH = CONFIG_DIR / "startup.json"

DEFAULT_PLAN = {
    "auto_on_boot": True,
    "kill_on_start": True,
    "kill_scope": ["server", "controller"],
    "steps": [
        {"id": "zenoh", "label": "zenoh 라우터", "machine": "server", "kind": "zenoh",
         "command": "ros2 run rmw_zenoh_cpp rmw_zenohd", "delay_s": 0},
        {"id": "robot_urdf", "label": "Robot URDF", "machine": "server", "kind": "launch",
         "command": "ros2 launch w_type_mm robot.launch.py", "delay_s": 3},
        {"id": "controller", "label": "Controller", "machine": "controller", "kind": "launch",
         "command": "ros2 launch w_type_mm control.launch.py", "delay_s": 3},
    ],
}


def load_plan() -> dict:
    if PLAN_PATH.is_file():
        try:
            return json.loads(PLAN_PATH.read_text(encoding="utf-8"))
        except Exception as exc:  # noqa: BLE001
            logger.warning("startup.json 파싱 실패, 기본값 사용: %s", exc)
    return dict(DEFAULT_PLAN)


def save_plan(plan: dict) -> dict:
    PLAN_PATH.parent.mkdir(parents=True, exist_ok=True)
    PLAN_PATH.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    return plan
