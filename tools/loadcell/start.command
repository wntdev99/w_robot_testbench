#!/bin/bash
# macOS 더블클릭 실행 — 의존성 확인 후 서버 시작
cd "$(dirname "$0")" || exit 1
echo "[로드셀] 의존성 확인 중…"
python3 -c "import Phidget22" 2>/dev/null || python3 -m pip install Phidget22 --break-system-packages
echo "[로드셀] 서버 시작 → http://localhost:8765  (이 창을 닫으면 종료)"
python3 loadcell_server.py
