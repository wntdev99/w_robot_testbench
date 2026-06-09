# 도구 권장안 — SSH 실측 기반 결론

> 202·201 두 머신을 SSH로 종합 점검(시스템 사양·라이브 ROS 그래프·기존 자산)한 결과에 근거한 권장안.
> 점검일 2026-06-09.

---

## 1. 실측 요약 (근거)

### 1.1 하드웨어/환경

| 항목 | 202 (서버/PC1) | 201 (컨트롤러/PC2) |
|---|---|---|
| CPU | Intel i7-14700T, **28 스레드** | **Cortex-A72 4코어** (Raspberry Pi 4급 ARM) |
| RAM | 15 GiB | 7.6 GiB |
| 온도센서 | `x86_pkg_temp`/`iwlwifi` + `sensors`(lm-sensors) | `cpu-thermal` |
| 네트워크 | eno1 유선 UP, wifi DOWN | eth0 유선 UP, wlan0 DOWN |
| CAN | **`can_bms`, `can_chg` UP** (전장부 CAN이 202에 있음) | 모터 `can2` (control.launch.py가 기동, 평시 미구성) |
| Python | 3.12.3, psutil✅, **fastapi❌ uvicorn❌** (pip 필요) | 3.12.3, psutil✅ |
| Node | v18.19.1 / npm 9.2.0 | — |

→ **202는 백엔드+프론트빌드+zenoh+RSP+전장부 드라이버 전부 감당할 여유**가 충분.
→ **201은 ARM 저사양** — 웹 스택 배포 금물, **SSH 런치 전용**이 정답(기존 결정과 일치).
→ **전장부(DALY BMS/Elyx RX) CAN이 202에 있음** → 전장부 드라이버는 202에서 구동 (DESIGN.md 보정 필요).

### 1.2 라이브 ROS 그래프

- 점검 시점 **로봇 OFF**: zenoh 라우터 미실행, controller_manager/노드 없음, 토픽 비어 있음.
- 202의 ros2 daemon은 `rmw_fastrtps_cpp`로 떠 있었음(데몬 기본값) — 실제 통신 RMW는 env의 `rmw_zenoh_cpp`.
- → **라이브 토픽/타입은 로봇 기동 후 실측**해야 하며, 설계는 토픽을 **런타임 동적 발견**해야 함(하드코딩 금지).

### 1.3 결정적 발견 — 기존 자산 `bt_execution_gui`

202의 `~/ros2_ws/src/bt_execution_gui`에 **동일 목적(ROS2 웹 운영 GUI)의 완성형 풀스택**이 이미 존재. 같은 메인테이너(`jeongmin.choi@wattrobotics.ai`).

- **백엔드 `bt_web_bridge/`** (FastAPI+rclpy, 성숙): `main.py`(rclpy.init→Node+executor 스레드→manifest 로드→self_check→FastAPI), `ros_bridge.py`(rclpy future→asyncio 래핑), `ws_manager.py`(broadcast bus + welcome snapshot), `manifest_loader.py`(.meta.yaml), `scenario_storage.py`(YAML, git tracked), `history_db.py`(sqlite), `lock_manager`, `payload_validator`, `self_check`(startup drift, fail-fast), `emergency.py`(전역 E-stop), `api/`(execute·scenarios·trees·ws·status·history) — **테스트까지** 완비.
- **프론트 `frontend/`**: **Next.js 14(App Router)+TS+Tailwind+shadcn/ui**, zustand, react-hook-form+zod, motion, lucide, react-flow, dnd-kit. `hooks/useWebSocket.ts`, `api/client.ts`, components(StatusPulse, EmergencyStopBar, ParamForm…).
- **docs 6종**: 01_system_design / 02_schema_extraction / 03_api_protocol / 04_open_questions / 05_handoff_notes / 06_environment_setup.
- **철학**: 4-Layer Defense, Code-First drift-zero, 전역 Emergency Stop 필수, 사내망 CORS, colcon+systemd 배포.

설치된 시각화 패키지는 **rqt_* 뿐**(데스크톱 X11 전용). **foxglove/rosbridge/plotjuggler/rosboard 미설치**.

---

## 2. 핵심 판단 — "어떤 툴이 좋은가"

### 2.1 기성 도구(Foxglove/rosbridge/PlotJuggler/rqt)로 충분한가? → **아니오**

| 요구사항 | rqt | PlotJuggler | Foxglove(+bridge) | rosbridge_suite |
|---|:--:|:--:|:--:|:--:|
| 브라우저로 네트워크 접속 | ❌(X11) | ❌(데스크톱) | ✅ | ✅(라이브러리) |
| 토픽 플롯 | △ | ◎ | ◎ | △ |
| **런치/노드 런타임 기동·종료** | ❌ | ❌ | ❌ | ❌ |
| **201 SSH 런치 제어** | ❌ | ❌ | ❌ | ❌ |
| **zenoh 라우터 상태·자동기동** | ❌ | ❌ | ❌ | ❌ |
| **프로파일 묶음(exclusive) 오케스트레이션** | ❌ | ❌ | ❌ | ❌ |
| 시스템/원격머신 모니터 | ❌ | ❌ | △ | ❌ |
| **사용자 친화 publish/service/action 폼** | △ | ❌ | △ | ❌ |
| 스냅샷/CSV·JSON 자산화 | ❌ | △ | △ | ❌ |
| Toss풍 통합 UX | ❌ | ❌ | ❌ | ❌ |

→ **프로세스 오케스트레이션·SSH·zenoh 관리·프로파일은 어떤 기성 도구도 못 한다.** 커스텀 백엔드(FastAPI+rclpy)는 **불가피**. 기성 도구는 기껏해야 "플롯 한 조각"만 대체할 뿐, 통합 운영툴을 줄 수 없다.

### 2.2 그러면 새 스택을 설계할까? → **아니오. `bt_execution_gui` 패턴을 그대로 계승**

같은 회사·같은 메인테이너·같은 머신(202)·같은 목적(ROS2 웹 운영툴)의 **검증된 풀스택이 이미 있다.** 새 스택(React+Vite+uPlot 등)을 발명하는 것은 *근거 없는 분기*이며 유지보수·일관성·학습비용에서 손해. **DESIGN.md §1의 잠정 스택(React+Vite+uPlot)을 폐기하고 하우스 스택으로 교체**한다.

---

## 3. 최종 권장안

### 3.1 스택 (bt_execution_gui와 100% 정렬)

| 레이어 | 채택 | 비고 |
|---|---|---|
| 백엔드 | **Python + rclpy + FastAPI + uvicorn** | `ros_bridge`/`ws_manager`/`manifest_loader`/`self_check` 패턴 재사용 |
| 프론트 | **Next.js 14 (App Router) + TS + Tailwind + shadcn/ui** | `useWebSocket.ts`/`api/client.ts`/StatusPulse/EmergencyStopBar 재사용 |
| 상태/폼 | zustand + react-hook-form + zod | **zod 폼은 publish/service/action 동적 폼에 직격** |
| 애니메이션/아이콘 | motion + lucide-react | Toss풍 |
| **플롯(신규 추가)** | **uPlot** (Next.js 클라이언트 컴포넌트로 래핑) | bt_gui엔 플롯이 없음. 경량·고성능, 단일 앱 응집 유지. (대안: 필요 시 foxglove_bridge 병행은 후순위) |
| API 타입 | openapi-typescript (`/openapi.json` → `types.gen.ts`) | bt_gui와 동일 워크플로 |
| 배포 | colcon package + systemd | 202에 pip로 fastapi/uvicorn 설치 선행 |

### 3.2 아키텍처 패턴 매핑 (testbench 요구 ← bt_gui 자산)

| testbench 요구 | 계승할 bt_gui 패턴 |
|---|---|
| 런치 묶음(프로파일) YAML | `manifest_loader` + `.meta.yaml` / `scenario_storage`(YAML, git) |
| 자동 순차기동 + 헬스체크 | `self_check`(startup drift, fail-fast) 확장 |
| 실시간 토픽/모니터 스트림 | `ws_manager`(broadcast bus + welcome snapshot) 그대로 |
| service/action 호출 | `ros_bridge`(rclpy future→asyncio) 그대로 |
| UI 스냅샷 저장/복원 | `scenario_storage`(YAML) 패턴 재사용 |
| CSV/JSON·실행 이력 자산화 | `history_db`(sqlite) 패턴 재사용 |
| **모터 제어 안전** | **`emergency.py` 전역 Emergency Stop — testbench엔 필수**(모터/텔레옵 즉시 정지) |
| API/WS 규약 | `docs/03_api_protocol.md` 이벤트 envelope 규약 답습 |

### 3.3 메인 페이지 패러다임 (와이어프레임 10안 → 확정)

bt_gui 프론트가 이미 **App Router 라우트 + 카드/모니터 컴포넌트 + 전역 StatusPulse·EmergencyStopBar** 구조다. 이와 정렬하면 자연스럽게 **합성안**으로 수렴:

- **셸**: 사이드바(1안) 또는 상단탭 + **전역 상태바(StatusPulse: zenoh/201/CPU/온도) + 전역 Emergency Stop 바**(상시 노출)
- **랜딩(홈)**: Toss풍 대시보드(2안) — 상태 카드 + 빠른 시작(프로파일) + 즐겨찾기 플롯
- **데이터 페이지**: 도킹 워크스페이스(3안) — uPlot 멀티 플롯 + 스냅샷
- **전역 보조**: ⌘K 커맨드 팔레트(5안)
- **확장**: 가이드 위저드(8안=출고 점검)·위젯 보드(9안=스냅샷 재현)

### 3.4 하드웨어 정렬 조치

1. **전장부 드라이버는 202에서 구동** (can_bms/can_chg가 202) — DESIGN.md §0.2/§5 보정
2. **201은 SSH 런치 전용** 유지 (ARM 저사양) — 웹/백엔드 미배포
3. 202에 **fastapi/uvicorn pip 설치** 선행 (06_environment_setup 류 문서화)
4. 시스템 모니터는 psutil(설치됨) + `sensors`/`/sys/class/thermal` 활용. 201 stats는 ROS2 토픽 우선, 없으면 SSH psutil fallback
5. 토픽/타입은 **런타임 동적 발견** (로봇 OFF 시점이라 하드코딩 불가, 근거상 필수)

---

## 4. 권장 결론 (한 줄)

> **`bt_execution_gui`의 검증된 하우스 스택(FastAPI+rclpy / Next.js14+Tailwind+shadcn/ui)과 백엔드 패턴(ros_bridge·ws_manager·manifest·self_check·emergency)을 그대로 계승해, w_robot_testbench를 그 자매 도구로 신규 구축한다. 플롯만 uPlot으로 보강한다. 기성 도구(Foxglove 등)는 오케스트레이션 요구를 충족 못 하므로 채택하지 않는다.**

## 5. 다음 액션 후보
1. DESIGN.md §1 스택 절을 본 권장안으로 교체(잠정 React+Vite → Next.js 하우스 스택)
2. bt_web_bridge 핵심 모듈(`ros_bridge`·`ws_manager`·`manifest_loader`·`self_check`) 정독 후 재사용 경계 확정
3. 로봇 기동 상태에서 라이브 토픽/타입/서비스/액션/diagnostics 실측 → DESIGN §7 미해결 항목 해소
4. testbench용 docs 6종 골격을 bt_gui 구조에 맞춰 생성
