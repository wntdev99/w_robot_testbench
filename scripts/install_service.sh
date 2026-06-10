#!/usr/bin/env bash
# 백엔드를 systemd 서비스로 등록 → 로봇(202) 부팅 시 자동 시작.
# 환경은 run_server.sh 가 명시적으로 source 하므로 .bashrc 의존이 없다.
# 추가 사용자 env 가 필요하면 config/server.env(키=값, gitignore)에 넣으면 주입된다.
#
# 실행 위치: 서버 202 에서 1회. (sudo 필요)
#   기본 사용자=현재 사용자. 다른 사용자로: SERVICE_USER=james ./scripts/install_service.sh
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
USER_NAME="${SERVICE_USER:-$(id -un)}"
UNIT_NAME="w-robot-testbench.service"
UNIT_PATH="/etc/systemd/system/$UNIT_NAME"

chmod +x "$DIR/scripts/run_server.sh"

echo "[install-service] 유닛 생성: $UNIT_PATH (User=$USER_NAME, WorkingDirectory=$DIR)"
sudo tee "$UNIT_PATH" >/dev/null <<EOF
[Unit]
Description=w_robot_testbench web server
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$DIR
ExecStart=$DIR/scripts/run_server.sh
Restart=on-failure
RestartSec=3
# 추가 환경변수가 필요하면 config/server.env 에 'KEY=VALUE' 로 작성(파일 없으면 무시).
EnvironmentFile=-$DIR/config/server.env

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now "$UNIT_NAME"
echo "[install-service] 완료 — 부팅 시 자동 시작 + 지금 기동됨."
echo "  상태:  systemctl status $UNIT_NAME"
echo "  로그:  journalctl -u $UNIT_NAME -f"
echo "  중지:  sudo systemctl stop $UNIT_NAME      (자동시작 해제: sudo systemctl disable $UNIT_NAME)"
