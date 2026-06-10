#!/usr/bin/env bash
# 백엔드 실행 wrapper — systemd/부팅 환경엔 .bashrc 가 적용되지 않으므로
# 여기서 ROS 환경을 명시적으로 source 한 뒤 서버를 띄운다.
# 환경변수로 오버라이드: ROS_DISTRO, TESTBENCH_WS_SETUP, RMW_IMPLEMENTATION, 그리고 인자(예: --port 8099)
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"

# 1) ROS 배포본 소싱
ROS_DISTRO="${ROS_DISTRO:-jazzy}"
[ -f "/opt/ros/$ROS_DISTRO/setup.bash" ] && source "/opt/ros/$ROS_DISTRO/setup.bash"

# 2) 워크스페이스 오버레이 소싱 — repo 가 <ws>/src/w_robot_testbench 구조면 <ws>/install 추정
WS_SETUP="${TESTBENCH_WS_SETUP:-}"
if [ -z "$WS_SETUP" ]; then
  CAND="$(cd "$DIR/../.." 2>/dev/null && pwd)/install/setup.bash"
  [ -f "$CAND" ] && WS_SETUP="$CAND"
fi
[ -n "$WS_SETUP" ] && [ -f "$WS_SETUP" ] && source "$WS_SETUP"

# 3) zenoh RMW (202 는 로컬 라우터에 접속)
export RMW_IMPLEMENTATION="${RMW_IMPLEMENTATION:-rmw_zenoh_cpp}"

cd "$DIR/backend"
exec python3 -m testbench.main "$@"
