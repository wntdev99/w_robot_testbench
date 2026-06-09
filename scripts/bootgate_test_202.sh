#!/usr/bin/env bash
# 202(server)용 백엔드 mock — Clean-Slate + baseline 기동 end-to-end 검증.
# 단계: 0(스냅샷) A(종료) B(기동) C(검증). 201은 SSH로 bootgate_test_201.sh 호출.
# 종료는 PID 기반(pkill -f 회피). 가동 중 실제 런치 대상.
PHASE="${1:-}"   # set -u 미사용: ROS setup.bash가 미정의 변수 참조
source /opt/ros/jazzy/setup.bash 2>/dev/null
source ~/ros2_ws/install/setup.bash 2>/dev/null
export RMW_IMPLEMENTATION=rmw_zenoh_cpp
SSH201='ssh -o BatchMode=yes -o ConnectTimeout=8 ubuntu@192.168.34.201'
PAT='rmw_zenohd|ros2_ws/install|/opt/ros/jazzy/lib|_ros2_daemon|bin/ros2'

case "$PHASE" in
  0)
    echo "[202 nodes]"; timeout 15 ros2 node list 2>/dev/null | sort
    echo "[202 ROS proc count]"; pgrep -fc "$PAT" 2>/dev/null || echo 0
    echo "[201 ROS proc count]"; $SSH201 'bash /tmp/tb201.sh count' 2>/dev/null | tail -1
    ;;
  A)
    echo "--- 202: launch 부모 INT ---"
    for p in $(pgrep -f "bin/ros2 launch"); do echo "INT $p"; kill -INT "$p" 2>/dev/null; done
    sleep 4
    L=$(pgrep -f "$PAT"); [ -n "$L" ] && { echo "TERM $L"; kill -TERM $L 2>/dev/null; sleep 3; }
    L=$(pgrep -f "$PAT"); [ -n "$L" ] && { echo "KILL $L"; kill -KILL $L 2>/dev/null; sleep 1; }
    echo "202_remaining=$(pgrep -fc "$PAT" 2>/dev/null || echo 0)"
    echo "--- 201: Clean-Slate ---"
    $SSH201 'bash /tmp/tb201.sh A' 2>/dev/null | tail -1
    ;;
  B)
    echo "--- zenoh (skip if running) ---"
    if ! pgrep -f rmw_zenohd >/dev/null; then setsid ros2 run rmw_zenoh_cpp rmw_zenohd >/tmp/tb_zenoh.log 2>&1 & sleep 3; fi
    pgrep -f rmw_zenohd >/dev/null && echo "zenoh OK" || echo "zenoh FAIL"
    echo "--- robot.launch (202) + healthcheck /robot_description ---"
    setsid ros2 launch w_type_mm robot.launch.py >/tmp/tb_robot.log 2>&1 &
    ok=FAIL; for i in $(seq 1 25); do timeout 8 ros2 topic list 2>/dev/null | grep -q robot_description && { ok=OK; break; }; sleep 1; done
    echo "robot_urdf $ok"
    echo "--- control.launch (201 SSH) + healthcheck controller_manager ---"
    $SSH201 'bash /tmp/tb201.sh B' 2>/dev/null | tail -1
    ok=FAIL; for i in $(seq 1 30); do timeout 8 ros2 node list 2>/dev/null | grep -q controller_manager && { ok=OK; break; }; sleep 1; done
    echo "controller $ok"
    ;;
  C)
    echo "[복구된 nodes (baseline만: robot_state_publisher + 201 컨트롤러)]"
    timeout 15 ros2 node list 2>/dev/null | sort
    ;;
esac
