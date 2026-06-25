# w_robot_mcp

Claude Desktop으로 로봇 테스트벤치를 조작·관측·테스트하는 MCP 서버.
**기존 testbench 백엔드는 무수정** — 이 MCP는 그 HTTP/WS API를 호출하는 얇은 클라이언트다.
설계 SSOT: [`../../docs/mcp-design.md`](../../docs/mcp-design.md).

> 현재 상태: **M0 스캐폴드** (도구 `health`, `get_system_status`). 이후 M1~M5에서 확장.

## 빌드 & 패키징 (빌더 1회)
```bash
cd tools/w_robot_mcp
npm install
npm run build            # src/*.ts → server/*.js
npx mcpb pack            # manifest + server + node_modules → w_robot.mcpb
```
→ 생성된 `w_robot.mcpb` 파일을 팀에 배포(사내 드라이브/메신저). ⚠ 서명 없음 → 신뢰 경로로만.

## 사용자 설치 (각 PC 1회)
1. **Claude Desktop** 설치 + 로봇 Wi-Fi 연결 + 로봇 서버(202)가 켜져 있을 것.
2. `w_robot.mcpb` **더블클릭** → 설치 대화상자에서 **로봇 서버 주소** 확인(기본 `http://192.168.34.202:8080`) → 설치 → 재시작.
3. 채팅에서 "연결됐어?" / "상태 보여줘"로 확인.

런타임(Node)은 Claude Desktop에 내장 → 별도 설치 불필요.

## 로컬 개발 검증 (로봇 없이)
백엔드를 dev 포트로 띄우고 MCP를 직접 실행해 도구를 확인:
```bash
# 터미널 A — 백엔드(개발 PC, ROS 소싱 필요)
cd ../../backend && python3 -m testbench.main --port 8099

# 터미널 B — MCP 단독 실행 (stdio; MCP Inspector 등으로 접속)
cd tools/w_robot_mcp
TESTBENCH_BASE=http://localhost:8099 npm start
```
또는 `claude_desktop_config.json`에 로컬 stdio로 등록(개발용):
```json
{ "mcpServers": {
    "w_robot_dev": {
      "command": "node",
      "args": ["<절대경로>/tools/w_robot_mcp/server/index.js"],
      "env": { "TESTBENCH_BASE": "http://localhost:8099" }
    }
} }
```

## 환경변수
| 변수 | 기본 | 의미 |
|---|---|---|
| `TESTBENCH_BASE` | `http://192.168.34.202:8080` | testbench 백엔드 주소 |
| `LOADCELL_BASE` | `http://localhost:8765` | 로드셀 서버(별도 설치, 선택) |
| `MCP_ALLOW_DESTRUCTIVE` | `0` | 1이면 파괴적 동작(시작플랜/kill) 허용 |
| `W_ROBOT_LOG_DIR` | `~/w_robot_logs` | 신호 로거·세션 이벤트 로그 저장 폴더 |

## 로그 보기
- **범용 신호 로거**: `start_signal_log(['/can_bms/status'])` → 흔들기/주행 등 길게 기록(링버퍼 30s 제한 없음) → `stop_signal_log` → `analyze_log(field='alive')`로 전이/끊김 집계. `tail_log`로 raw 확인.
- **세션 이벤트 로그**: 실행한 도구(주행/정지/보정/에러 등)가 자동 기록됨 → `view_events`로 복기.
