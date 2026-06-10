#!/usr/bin/env bash
# 서버(202)에서 컨트롤러(201)로 '비밀번호 없는' 키 기반 SSH 를 세팅한다.
# 백엔드의 원격 런치 기동/종료(remote_ssh.py)는 BatchMode=yes(키 전용)라
# 이 세팅이 안 되어 있으면 201 대상 모든 원격 명령이 조용히 실패한다.
#
# 동작: 로컬 SSH 키 확인(없으면 ed25519 생성) → 키 인증 테스트
#       → 안 되면 ssh-copy-id(컨트롤러 비밀번호 1회 입력) → 재검증.
# 실행 위치: 서버 202 에서 1회. (대상은 config/testbench.yaml 의 controller)
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
CFG="${TESTBENCH_CONFIG_DIR:-$DIR/config}/testbench.yaml"

# config 에서 controller host/ssh_user 읽기(파싱 실패 시 기본값). 환경변수로 오버라이드 가능.
read_cfg() {
  python3 - "$CFG" 2>/dev/null <<'PY' || true
import sys, yaml
try:
    d = yaml.safe_load(open(sys.argv[1])) or {}
except Exception:
    d = {}
m = (d.get("machines") or {}).get("controller") or {}
print(m.get("host", "192.168.34.201"))
print(m.get("ssh_user", "ubuntu"))
PY
}
mapfile -t C < <(read_cfg)
HOST="${CTRL_HOST:-${C[0]:-192.168.34.201}}"
USER="${CTRL_USER:-${C[1]:-ubuntu}}"
TARGET="$USER@$HOST"
SSH_OPTS=(-o ConnectTimeout=5 -o StrictHostKeyChecking=accept-new)

echo "[setup-ssh] 대상 컨트롤러: $TARGET"

# 1) 로컬 SSH 키 확인/생성
if ls "$HOME"/.ssh/id_* >/dev/null 2>&1; then
  echo "[setup-ssh] 기존 SSH 키 발견."
else
  echo "[setup-ssh] SSH 키 없음 → ed25519 키 생성"
  ssh-keygen -t ed25519 -N "" -f "$HOME/.ssh/id_ed25519"
fi

# 2) 이미 키 인증으로 접속되는지 확인
if ssh -o BatchMode=yes "${SSH_OPTS[@]}" "$TARGET" true 2>/dev/null; then
  echo "[setup-ssh] ✓ 이미 키 인증으로 접속됩니다 — 세팅 불필요."
  exit 0
fi

# 3) 키 인증 안 됨 → ssh-copy-id (컨트롤러 비밀번호 1회 입력)
echo "[setup-ssh] 키 인증 불가 → ssh-copy-id 실행. 아래에서 '$TARGET' 의 비밀번호를 입력하세요."
ssh-copy-id "${SSH_OPTS[@]}" "$TARGET"

# 4) 재검증
if ssh -o BatchMode=yes "${SSH_OPTS[@]}" "$TARGET" true 2>/dev/null; then
  echo "[setup-ssh] ✓ 키 인증 성공 — 이제 비밀번호 없이 접속됩니다."
else
  echo "[setup-ssh] ✗ 여전히 실패. 컨트롤러의 sshd 설정(PubkeyAuthentication yes)과 네트워크를 확인하세요." >&2
  exit 1
fi
