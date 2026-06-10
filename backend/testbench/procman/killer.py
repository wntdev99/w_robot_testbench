"""ros2 관련 프로세스 일괄 종료 (클린 슬레이트).

로컬(서버)은 psutil 로 마커 매칭 후 SIGINT→SIGKILL. 백엔드 자기 자신 제외.
원격(201)은 RemoteRunner.kill_ros2 (pkill, 자기 매칭 회피 위해 [r] 트릭).
"""
from __future__ import annotations

import logging
import os
import signal
import time

import psutil

logger = logging.getLogger("testbench.procman.killer")

# cmdline 에 아래 문자열이 있으면 ros2 관련으로 간주
MARKERS = (
    "ros2 launch", "ros2 run", "--ros-args", "rmw_zenohd", "ros2_control_node",
    "robot_state_publisher", "/opt/ros/jazzy/lib/", "component_container",
)
# 절대 죽이면 안 되는 것 (백엔드 자신)
EXCLUDE = ("testbench.main", "ros2-daemon", "ros2cli.daemon")


def kill_local_ros2(grace: float = 1.5) -> list[int]:
    me = os.getpid()
    victims: list[psutil.Process] = []
    for p in psutil.process_iter(["pid", "cmdline"]):
        if p.pid == me:
            continue
        cmd = " ".join(p.info.get("cmdline") or [])
        if not cmd:
            continue
        if any(x in cmd for x in EXCLUDE):
            continue
        if any(m in cmd for m in MARKERS):
            victims.append(p)
    for p in victims:
        try:
            p.send_signal(signal.SIGINT)
        except Exception:  # noqa: BLE001
            pass
    time.sleep(grace)
    killed: list[int] = []
    for p in victims:
        try:
            if p.is_running():
                p.kill()
            killed.append(p.pid)
        except Exception:  # noqa: BLE001
            pass
    logger.info("로컬 ros2 종료: %d개 %s", len(killed), killed)
    return killed
