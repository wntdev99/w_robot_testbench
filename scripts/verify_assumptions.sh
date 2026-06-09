#!/usr/bin/env bash
# w_robot_testbench — 아키텍처 4대 구조 가정 + 보조 2개 검증 (read-only)
#
# 목적: 토픽/노드 카탈로그 수집이 아니라, "설계 가정이 실제로 성립하는가"의 합격/불합격 판정.
# 전제: 202 = zenoh + robot.launch.py 가동, 201 = control.launch.py 가동. 개발PC에서 실행.
# 주의: 켜져 있는 프로세스를 종료하지 않는다(식별·조회만).
set -uo pipefail

S202="james@192.168.34.202"
S201="ubuntu@192.168.34.201"
SSH="ssh -o BatchMode=yes -o ConnectTimeout=8"
PFX202='source /opt/ros/jazzy/setup.bash; source ~/ros2_ws/install/setup.bash; export RMW_IMPLEMENTATION=rmw_zenoh_cpp;'

echo "### 검증1: zenoh 단일 라우터 + 디스커버리 (202에서 201 컨트롤러 노드 가시?)"
$SSH $S202 "$PFX202 timeout 20 ros2 node list 2>/dev/null | grep -qE 'controller_manager|swerve_controller|steering_moteus' \
  && echo 'V1 PASS: 202에서 201 노드 가시' || echo 'V1 FAIL'"

echo "### 검증2: 202 -> 201 무인 SSH"
$SSH $S202 "$SSH $S201 'echo V2_PASS \$(hostname)'" 2>&1 | tail -1

echo "### 검증3: ROS 프로세스 식별 (boot_gate 패턴, read-only)"
$SSH $S202 "pgrep -af 'rmw_zenohd|ros2 launch|ros2 run|/opt/ros/|ros2_ws/install' 2>/dev/null | grep -v pgrep | wc -l \
  | xargs -I{} echo 'V3: {} ROS 프로세스 식별됨'"

echo "### 검증4 + 보조A: cmd_vel 타입 + 타입->필드 introspection"
$SSH $S202 "$PFX202 T=\$(timeout 15 ros2 topic type /swerve_controller/cmd_vel 2>/dev/null); \
  echo \"cmd_vel type: \$T\"; timeout 15 ros2 interface show \"\$T\" 2>/dev/null | head -6"

echo "### 보조B: /diagnostics 구조 (모터 텔레메트리 통로)"
$SSH $S202 "$PFX202 echo 'type:' \$(timeout 10 ros2 topic type /diagnostics 2>/dev/null); \
  timeout 8 ros2 topic echo --once /diagnostics 2>/dev/null | grep -E 'key:|hardware_id:' | head -15"

echo "=== 검증 완료 ==="

# ─────────────────────────────────────────────────────────────
# [부트스트랩] 202->201 무인 SSH 1회 설정 (검증2가 FAIL일 때만, 수동 실행)
# 방법 a) 개발PC가 201에 무인 접속 가능하면 (비번 불요):
#   PUB=$($SSH $S202 'test -f ~/.ssh/id_ed25519.pub || ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 >/dev/null; cat ~/.ssh/id_ed25519.pub')
#   $SSH $S201 "mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && grep -qxF '$PUB' ~/.ssh/authorized_keys || echo '$PUB' >> ~/.ssh/authorized_keys"
# 방법 b) 제품 서버(202 단독): admin "201 연결 설정"에서 비번 1회 입력 -> ssh-copy-id -> 비번 폐기. (비번 영구저장 금지)
