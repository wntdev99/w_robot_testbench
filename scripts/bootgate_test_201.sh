#!/usr/bin/env bash
# 201(controller)용 Clean-Slate/baseline 검증 보조 — 202가 SSH로 phase 호출.
# 환경은 명시 source/export(비대화형 SSH는 .bashrc 미로드). setsid가 이 환경을 상속.
PHASE="${1:-}"   # set -u 미사용: ROS setup.bash가 미정의 변수 참조
export LC_ALL=C
source /opt/ros/jazzy/setup.bash 2>/dev/null
source ~/colcon_ws/install/setup.bash 2>/dev/null
export RMW_IMPLEMENTATION=rmw_zenoh_cpp
export ZENOH_CONFIG_OVERRIDE='mode="client";connect/endpoints=["tcp/192.168.34.202:7447"]'
PAT='colcon_ws/install|/opt/ros/jazzy/lib|_ros2_daemon|bin/ros2'

case "$PHASE" in
  count) pgrep -fc "$PAT" 2>/dev/null || echo 0 ;;
  A)  # Clean-Slate: launch 부모 INT(자식 정리) -> 잔존 TERM -> KILL
    for p in $(pgrep -f "bin/ros2 launch"); do kill -INT "$p" 2>/dev/null; done
    sleep 4
    L=$(pgrep -f "$PAT"); [ -n "$L" ] && { kill -TERM $L 2>/dev/null; sleep 3; }
    L=$(pgrep -f "$PAT"); [ -n "$L" ] && { kill -KILL $L 2>/dev/null; sleep 1; }
    echo "201_remaining=$(pgrep -fc "$PAT" 2>/dev/null || echo 0)"
    ;;
  B)  # baseline: control.launch 재기동(setsid=세션분리, 환경 상속)
    setsid ros2 launch w_type_mm control.launch.py ekf_enable:=true >/tmp/tb_control.log 2>&1 &
    echo "control_launched pid=$!"
    ;;
esac
