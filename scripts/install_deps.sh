#!/usr/bin/env bash
# 백엔드 의존성 설치 — rosdep(권장) 또는 apt. PEP668 회피(pip 미사용).
set -e
DIR="$(cd "$(dirname "$0")/.." && pwd)"
if command -v rosdep >/dev/null 2>&1; then
  echo "[rosdep] backend/package.xml 의존 설치 (apt)"
  rosdep install --from-paths "$DIR/backend" --ignore-src -r -y --skip-keys ament_python
else
  echo "[apt] rosdep 없음 → apt 직접 설치"
  sudo apt update
  sudo apt install -y python3-fastapi python3-uvicorn python3-pydantic \
    python3-psutil python3-yaml python3-opencv \
    ros-jazzy-rclpy ros-jazzy-rosidl-runtime-py ros-jazzy-tf2-ros ros-jazzy-cv-bridge
fi
echo "완료. 실행: cd backend && python3 -m testbench.main"
