# 배포 가이드 — HW팀 PC 이식 + 로드셀 LAN 연동

대상: 하드웨어팀이 각자 PC(Claude Desktop)에서 w_robot MCP로 로봇을 조작·테스트.
설계 SSOT: [`../../docs/mcp-design.md`](../../docs/mcp-design.md).

---

## A. MCP를 HW팀 PC에 이식 (PC당 1회)

산출물: **`w_robot_mcp.mcpb`** (이 폴더에서 `npm run pack`으로 생성).

### A-1. 빌더(관리자) 1회
```bash
cd tools/w_robot_mcp
npm install && npm run pack      # → w_robot_mcp.mcpb
```
→ 이 `.mcpb` 파일 하나를 사내 드라이브/메신저로 배포(신뢰 경로).

### A-2. 각 HW팀 PC (비개발자)
1. **Claude Desktop 설치** (Win/Mac). — Node 런타임 내장이라 별도 설치 불필요.
2. **로봇 Wi-Fi 연결** (192.168.34.x 망에서 서버 202에 닿아야 함).
3. **`w_robot_mcp.mcpb` 더블클릭** → 설치 대화상자에서 설정 입력:
   - **로봇 서버 주소**: `http://192.168.34.202:8080`
   - **로드셀 서버 주소**(선택): 아래 B 완료 후 `http://192.168.34.202:8765`
   - **파괴적 동작 허용**: `0` (일반 사용자)
4. Claude Desktop 재시작 → 채팅에 도구 표시 → "연결됐어?"로 확인.

> ※ 개발/검증은 Claude Code + `.mcp.json`(server/index.js 직접 실행)로. HW팀 실사용은 위 Desktop+.mcpb.

---

## B. 로드셀을 로봇 PC(202)에서 받게 하기

현재: 로드셀(Phidget)이 **사용자 노트북**에 연결, 서버가 `127.0.0.1`(로컬 전용) → 그 노트북에서만 읽힘.
목표: **로봇 PC(202)** 가 값을 받게 하여 MCP·누구나 LAN에서 측정값 수신.

### B-1. 로드셀 서버 위치 이전
1. **Phidget Bridge(1046) + 로드셀**을 측정 리그 근처의 **LAN 연결 PC(권장: 서버 202)** 에 USB로 연결.
2. 그 PC에 **Phidget 네이티브 드라이버** 설치 (OS별, `01_loadcell/PhidgetBridge_1046_장비가이드.md` §2).
3. `01_loadcell/`을 그 PC에 두고 의존성 설치 후 서버 실행:
   ```bash
   pip install -r requirements.txt      # 또는 pip install Phidget22
   python3 loadcell_server.py           # 기본 0.0.0.0:8765 (LAN 공개)
   ```
   - **LAN 공개**: 서버는 이제 `0.0.0.0:8765`로 바인드 → 같은 망의 MCP가 `http://<그PC IP>:8765`로 읽음.
   - 단일 PC 전용으로 막으려면: `LOADCELL_BIND=127.0.0.1 python3 loadcell_server.py`.
4. 로드셀 GUI(브라우저 `http://localhost:8765`)에서 **연결 → 영점 → 스팬(보정)** 1회.

### B-2. MCP에 로드셀 주소 알려주기
- 각 PC의 .mcpb 설치 시 **로드셀 서버 주소**에 `http://192.168.34.202:8765`(또는 로드셀이 붙은 PC IP) 입력.
- 이후 MCP가 자동 인식: `loadcell_status`(연결/보정) · `get_loadcell_reading`(현재 kg) · `loadcell_tare`(영점).
- 테스트 가압 스텝에서 `get_loadcell_reading`으로 힘(kg) 자동 캡처 → M4 `record_measurement`로 기록.

> ⚠ 로드셀 서버를 202에 두면 로봇과 함께 상시 측정 가능. 단 보정(영점/스팬)은 측정 환경에서 1회 필요.

---

## C. 동작 확인 (각 PC)
- "연결됐어?" → 서버 연결 ✅
- "로봇 상태 보여줘" → zenoh/컨트롤러/CPU
- (로드셀 연동 시) "로드셀 상태" → 연결/보정 확인
- "테스트 어떻게 시작해?" → 노션 기반 표준 절차(test_sop)

## D. 업데이트
- 도구·로직 변경 시: 빌더가 `npm run pack`으로 새 `.mcpb` 생성 → 배포 → 각 PC에서 더블클릭(덮어쓰기 업데이트).
- 백엔드는 무수정이므로 202는 그대로.
