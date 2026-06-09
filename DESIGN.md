# w_robot_testbench — 설계 문서 (SSOT, v0.2)

> 웹 기반 ROS2 로봇 테스트벤치. 로봇 네트워크(Wi-Fi)에 접속해 브라우저로 `http://192.168.34.202:<port>` 접속 시
> 로봇 운용/테스트 기능을 Toss풍 UX로 제공한다.
> **본 문서는 구현 전 합의 SSOT다.** 세부는 아래 부속 문서가 보강한다. 충돌 시 본 문서가 우선한다.

## 문서 인덱스
| # | 문서 | 내용 |
|---|---|---|
| ★ | **DESIGN.md (본 문서)** | 최상위 SSOT — 목표/토폴로지/스택/아키텍처/스키마/API/로드맵 |
| A | [`docs/tool-recommendation.md`](docs/tool-recommendation.md) | SSH 실측 근거 + "기성도구 X, 하우스 스택 계승" 권장 도출 |
| B | [`docs/hardware-test-mapping.md`](docs/hardware-test-mapping.md) | 하드웨어팀 52테스트 → 12역량 → 일반화 아키텍처 매핑 |
| C | [`docs/main-page-wireframes.md`](docs/main-page-wireframes.md) | 메인 페이지 패러다임 10안 와이어프레임 + 합성 결론 |
| D | [`docs/measured-interfaces.md`](docs/measured-interfaces.md) | 실측 인터페이스 인벤토리(현재=모바일베이스), 모터 텔레메트리=/diagnostics. manifest: `config/subsystems/mobile_base.yaml` |

> v0.1 → v0.2 변경: 잠정 스택(React+Vite+uPlot+TanStack)을 **폐기**하고 하우스 스택(Next.js14+FastAPI)으로 교체. 아키텍처를 Swerve/고정카테고리에서 **서브시스템 모듈 + 역량 레이어 + 테스트 런 엔진**으로 일반화. 전역 Emergency Stop·반복 내구성 러너 추가.

---

## 1. 목표와 범위

### 1.1 최종 목표
- 라이브 토픽 plot(PlotJuggler 대체), 런타임 런치/노드 기동·종료, 토픽 새로고침
- 사용자 친화 publish/service/action, zenoh 라우터 상태·자동기동
- 시스템 모니터(CPU/네트워크/인터넷/온도), 원격머신(201) 상태·연결 토폴로지·런치 제어
- diagnostics 시각화, CSV/JSON 자산화, UI 구성 스냅샷 저장·복원
- **하드웨어팀 52개 테스트(부속 B)를 최종적으로 모두 수용** — 반복 내구성, 서브시스템 구동, 모터 텔레메트리, 카메라 fps, CAN 진단 등

### 1.2 즉시 구현(P1) 범위
- 자동 순차기동 3대상(§2.3) + 텔레옵 묶음 + `joint_states`/모터 온도 플롯 + 컨트롤러 선택활성·직접명령

---

## 2. 확정 사실 (근거 기반 · 2026-06-09 SSH 실측)

### 2.1 머신 토폴로지
| 역할 | 머신 | 접속 | 워크스페이스 | 담당 |
|---|---|---|---|---|
| 개발 | 현재 PC | 로컬 | `~/ros2_ws` | 개발만, 배포 X |
| **서버 = PC1** | **192.168.34.202** | `ssh james@…` | `~/ros2_ws` | 웹툴 서버 배포처. URDF/센서/내비/텔레옵/**전장부(CAN)**/zenoh 라우터 |
| **컨트롤러 = PC2** | **192.168.34.201** | `ssh ubuntu@…` | **`~/colcon_ws`** | 모터/제어. 단일 런치 `control.launch.py`. **SSH 전용** |

공통: Ubuntu 24.04 / ROS2 Jazzy / `rmw_zenoh_cpp` / `ROS_AUTOMATIC_DISCOVERY_RANGE=SUBNET`.

### 2.2 하드웨어 현실 (부속 A §1.1)
- **202**: i7-14700T 28스레드 / 15GiB. `sensors`·psutil 있음, **fastapi/uvicorn 미설치(pip 필요)**, node v18. **전장부 CAN `can_bms`/`can_chg`가 202에 UP** → 무선충전/BMS 드라이버는 202 구동.
- **201**: Cortex-A72 4코어 / 7.6GiB (ARM SBC). 자원 제약 → **웹 스택 미배포, SSH 런치 전용**. 모터 CAN `can2`는 control.launch.py가 기동.
- 점검 시점 **로봇 OFF / zenoh 미실행** → 토픽/타입은 **런타임 동적 발견**(하드코딩 금지).

### 2.3 자동 순차 기동 3대상 (서버 기동 시)
```
① zenoh 라우터  (202 로컬)  : 미실행 시에만 → ros2 run rmw_zenoh_cpp rmw_zenohd
② robot urdf    (202 로컬)  : ros2 launch w_type_mm robot.launch.py      # robot_state_publisher
③ controller    (201 SSH)   : (export LC_ALL=C; source ~/colcon_ws/install/setup.bash;) ros2 launch w_type_mm control.launch.py
```
각 단계 헬스체크 통과 후 진행(순차·idempotent). ②는 `/robot_description` latched → ③ controller_manager가 구독(SSOT).

### 2.4 실측 자산
- 컨트롤러: `joint_state_broadcaster`, `swerve_controller`(`w_swerve_controller/WSwerveController`), `update_rate 30Hz`, cmd_vel=`/swerve_controller/cmd_vel`
- 텔레옵: `w_robot_teleoperation`(`teleop_joy.launch.py`+`twist_mux.launch.py`)
- 전장부: `wireless_charging_manager`(`daly_bms_driver`/`elyx_rx_driver`/`wireless_charging_monitor`)
- **기존 하우스 자산**: 202의 `bt_execution_gui`(FastAPI+rclpy / Next.js14 풀스택). 패턴 계승 대상(부속 A §1.3).

---

## 3. 기술 스택 (확정 = bt_execution_gui 하우스 스택 계승)

| 레이어 | 채택 | 비고 |
|---|---|---|
| 백엔드 | **Python + rclpy + FastAPI + uvicorn** | executor 스레드 + asyncio. `ros_bridge`/`ws_manager` 패턴 계승 |
| 프론트 | **Next.js 14 (App Router) + TS + Tailwind + shadcn/ui** | `useWebSocket.ts`/`api/client.ts`/StatusPulse/EmergencyStopBar 계승 |
| 상태/폼 | zustand + react-hook-form + zod | **zod 폼 = publish/service/action·서브시스템 컨트롤 동적 폼** |
| 애니/아이콘 | motion + lucide-react | Toss풍 |
| 플롯(신규) | **uPlot** (client 컴포넌트 래핑) | bt_gui엔 없음. 경량·고성능 시계열 |
| API 타입 | openapi-typescript (`/openapi.json`→`types.gen.ts`) | bt_gui 동일 워크플로 |
| 영상(역량 H) | MJPEG/WebRTC (별도 파이프라인) | 텍스트 플롯과 분리 설계 |
| 원격(201) | 런치=SSH(asyncssh), 데이터=ROS2(zenoh) | 하이브리드 |
| 모니터 | psutil + `sensors`/`/sys/class/thermal` | 201 stats는 ROS2 우선, SSH fallback |
| 배포 | colcon package + systemd | 202에 pip 설치 선행 |

> **기성 도구(Foxglove/rosbridge/PlotJuggler/rqt) 미채택** — 프로세스 오케스트레이션·SSH·zenoh·프로파일을 못 함(부속 A §2). 커스텀 백엔드 불가피.

---

## 4. 아키텍처 (일반화)

핵심: Swerve/고정 카테고리에 하드코딩하지 않고 **"공통 역량 레이어 + 서브시스템 모듈(선언형) + 테스트 런 엔진"**으로 일반화. 새 서브시스템·테스트는 **YAML manifest 추가만으로 확장**(부속 B §3).

### 4.1 공통 역량 레이어
```
L0 인프라/오케스트레이션 : zenoh·autostart·프로파일 묶음·201 SSH
L1 안전                  : 전역 Emergency Stop + 범퍼/정지우선 훅
L2 텔레옵                : 조이스틱 주행 공통
L3 측정·플롯 엔진        : 토픽/모터텔레메트리/센서/fps → uPlot 시계열 + WS 스트림
L4 명령 인터페이스       : publish/service/action 친화 폼(zod)
L5 테스트 런 엔진        : 반복 카운트·선행과제 검사·합/불 판정·결과 기록
L6 데이터 자산화         : CSV/JSON·이벤트/끊김 카운터·스냅샷·sqlite 이력
L7 카메라/영상           : MJPEG/WebRTC 스트림·이미지뷰·USB허브 제어
```

### 4.2 백엔드 구성도
```
[브라우저: Next.js] ⇄ REST/WS ⇄ [FastAPI 앱 (202)]
                                   ├─ ros_bridge   : rclpy Node + executor 스레드 (future→asyncio)
                                   ├─ ws_manager   : broadcast bus + welcome snapshot
                                   ├─ introspect   : 토픽/타입/서비스/액션 런타임 발견
                                   ├─ subscriber_pool : 동적 구독 → 스트림(L3)
                                   ├─ procman      : local subprocess + remote_ssh(201) + zenoh + orchestrator
                                   ├─ manifest     : profiles/subsystems/tests 로더 + self_check(drift)
                                   ├─ test_runner  : 반복/시퀀스/판정(L5)
                                   ├─ monitor      : psutil/sensors + 201 stats(L0)
                                   ├─ recorder     : CSV/JSON/counters(L6)
                                   └─ emergency    : 전역 E-stop(L1)
```

### 4.3 데이터 모델 (선언형 3종)
- **profile** — 런치 묶음(기동/종료 단위, `exclusive`, `depends_on`, `healthcheck`)
- **subsystem** — 서브시스템별 control 위젯 + telemetry + 안전 훅 (Swerve/Arm/Lift/Door/Conveyor/무선충전/카메라/LED)
- **test** — 52테스트 선언(선행과제·반복·기록·판정), 런 엔진이 소비

---

## 5. 레포 구조

```
w_robot_testbench/
├── DESIGN.md                       # 본 SSOT
├── docs/                           # 부속 A/B/C + (예정) 01~06 하우스 문서 체계
├── pyproject.toml                  # 백엔드
├── config/
│   ├── testbench.yaml              # 서버/머신/zenoh/liveness
│   ├── profiles/*.yaml             # 런치 묶음 (_autostart, teleop, door_test, motor_test, electrical …)
│   ├── subsystems/*.yaml           # 서브시스템 manifest (swerve, arm, door, conveyor, charging, camera, led)
│   ├── tests/*.yaml                # 52 테스트 카탈로그
│   └── snapshots/*.json            # UI 구성 스냅샷
├── backend/testbench/
│   ├── main.py                     # rclpy.init→Node+executor→manifest 로드→self_check→FastAPI→uvicorn
│   ├── ros/                        # node, introspect, subscriber_pool, publisher, service_action, controller
│   ├── procman/                    # local, remote_ssh, zenoh, orchestrator
│   ├── manifest/                   # loader, self_check (profiles/subsystems/tests)
│   ├── runner/                     # test_runner (반복·시퀀스·판정)
│   ├── monitor/                    # local_stats, remote_stats
│   ├── recorder/                   # csv/json, counters
│   ├── snapshots/                  # CRUD
│   ├── emergency.py                # 전역 E-stop
│   ├── ws_manager.py / ros_bridge.py
│   ├── api/                        # REST 라우터
│   └── ws/                         # WebSocket 핸들러
└── frontend/                       # Next.js 14
    └── src/
        ├── app/                    # 라우트: / (대시보드), system, launch, teleop, subsystems, plots, tests, data, command
        ├── components/             # StatusPulse, EmergencyStopBar, PlotPanel(uPlot), ParamForm(zod), SubsystemCard …
        ├── hooks/                  # useWebSocket, useApi
        ├── api/ lib/
```

---

## 6. 선언형 YAML 스키마 (요약)

### 6.1 `testbench.yaml`
```yaml
server: { host: 0.0.0.0, port: 8080 }
machines:
  server:     { host: 192.168.34.202, role: server }
  controller: { host: 192.168.34.201, ssh_user: ubuntu, ws: ~/colcon_ws,
                setup: "export LC_ALL=C; source ~/colcon_ws/install/setup.bash" }
zenoh: { router_cmd: "ros2 run rmw_zenoh_cpp rmw_zenohd", check: {method: process, match: rmw_zenohd} }
liveness: { controller_machine: { method: ping, host: 192.168.34.201, interval_s: 5 } }
```

### 6.2 profile (`config/profiles/*.yaml`) — §2.3·"이 묶음만 켜기"
```yaml
profile:
  id: teleop
  label: "조이스틱 텔레옵"
  exclusive: true                  # 이 묶음 외 비-persistent 프로파일은 종료
  processes:
    - { id: teleop_joy, machine: server, kind: launch,
        command: "ros2 launch w_robot_teleoperation teleop_joy.launch.py",
        healthcheck: {type: topic, topic: /joy, timeout_s: 10} }
    - { id: twist_mux, machine: server, kind: launch, depends_on: [teleop_joy],
        command: "ros2 launch w_robot_teleoperation twist_mux.launch.py" }
# _autostart.yaml: persistent:true, zenoh(skip_if_running:true)→robot_urdf→controller(machine:controller, SSH)
```

### 6.3 subsystem (`config/subsystems/*.yaml`) — 부속 B §3.2
```yaml
subsystem:
  id: door
  label: "도어 (뒷문/옆문)"
  launch_profile: door_test
  controls:        # → L4 폼/버튼
    - { id: rear_open, label: "뒷문 열기", kind: service, name: /door/rear/open }
    - { id: rear_force, label: "뒷문 힘", kind: topic, name: /door/rear/effort, type: std_msgs/Float64 }
  telemetry:       # → L3 플롯 / L6 기록
    - { topic: /door/rear/motor/current, plot: true }
    - { topic: /door/rear/hall, kind: state }
  sensors_state:   # → L1 안전
    - { topic: /bumper/triggered, on_true: estop }
```
> control/telemetry 이름은 **플레이스홀더** — 로봇 기동 후 실측으로 확정(§12).

### 6.4 test (`config/tests/*.yaml`) — 부속 B §3.3
```yaml
test:
  id: door_rear_durability        # No.18
  subsystem: door
  title: "뒷문 내구성 (반복 1000회)"
  prerequisites: []               # 선행과제 미충족 시 차단
  required_profiles: [door_test]
  cycle: { action: {open: /door/rear/open, close: /door/rear/close}, count: 1000, settle_s: 1.5 }
  record: { topics: [/door/rear/motor/current, /door/rear/hall], export: [csv],
            counters: [cycle_count, hall_zero_events] }
```

---

## 7. API / WebSocket 계약 (요지)

### 7.1 REST
| 경로 | 기능 |
|---|---|
| `GET /api/system/status` | zenoh·202/201 연결("단독/함께")·CPU/온도/net |
| `GET /api/profiles` · `POST /api/profiles/{id}/up\|down` | 프로파일 기동/종료(exclusive) |
| `GET /api/processes` · `POST·DELETE /api/processes` | 런치/노드 단건 제어(로컬+201 SSH) |
| `GET /api/topics?refresh=1` · `GET /api/topics/{n}/type` | 런타임 토픽·스키마 |
| `POST /api/publish` · `/api/service` · `/api/action` | 동적 명령(친화 폼) |
| `GET /api/controllers` · `POST /api/controllers/switch` | controller_manager |
| `GET /api/subsystems` · `GET /api/tests` · `POST /api/tests/{id}/run` · `/stop` | 서브시스템·테스트 카탈로그·런 엔진 |
| `POST /api/record/start\|stop?format=csv\|json` | 자산화 |
| `GET·POST·DELETE /api/snapshots` | UI 스냅샷 |
| `POST /api/emergency/stop` | 전역 E-stop |

### 7.2 WebSocket `/ws`
- `welcome` 스냅샷 → 재접속 복원(ws_manager 패턴)
- `{op:"sub", topic, fields}` 동적 구독 → throttle/downsample → `{topic, stamp, values}` 브로드캐스트
- 시스템 모니터·diagnostics·프로세스 상태·테스트 진행·카운터·E-stop 이벤트 동일 채널 push

---

## 8. 메인 페이지 / UX (부속 C 합성 결론)

- **셸**: 사이드바 내비 + **전역 상태바(StatusPulse: zenoh/201/CPU/온도)** + **전역 Emergency Stop 바**(상시)
- **랜딩(홈)**: Toss풍 대시보드 — 상태 카드 + 빠른 시작(프로파일) + 즐겨찾기 플롯
- **데이터/플롯**: 도킹 워크스페이스(uPlot 멀티플롯 + 스냅샷)
- **전역 보조**: ⌘K 커맨드 팔레트
- **확장**: 가이드 위저드(테스트 카탈로그 실행)·위젯 보드(스냅샷 재현)

### 8.1 네비 카테고리 (개정 9)
대시보드 · 시스템/인프라 · 런치 오케스트레이션 · 텔레옵 · 서브시스템 제어 · 측정·플롯 · 테스트 카탈로그·런 · 데이터 자산 · 명령(고급)

---

## 9. 역량 매핑 (부속 B §2 요약)
A 텔레옵 · B 모터 직접제어 · C 모터 텔레메트리 · D 액추에이터 구동 · **E 반복 내구성 러너** · F 센서/스위치 모니터 · G 충전/배터리 · H 카메라/영상 · I 도킹 · J CAN 진단 · K 자산화 · **L 안전(E-stop)**.
→ 레이어 L0~L7 + 서브시스템 모듈 + 테스트 런 엔진으로 전부 수용. 매핑 상세는 부속 B.

---

## 10. 안전 (L1)
- **전역 Emergency Stop**: UI 어디서나 1클릭. 모든 active goal cancel + cmd_vel 0 + 활성 액추에이터 정지(다중). `emergency.py` 패턴 확장.
- **범퍼 정지 우선**(테스트 30·32): `sensors_state.on_true: estop` 훅으로 선언.
- **파손 가능성** 테스트(17·19 등)는 카탈로그에 `damage_risk: true` 표기 → UI 경고.

---

## 11. 로드맵
| Phase | 범위 | 산출물 |
|---|---|---|
| P0 스캐폴딩 | 레포 골격, FastAPI+rclpy(ros_bridge/ws_manager 이식), Next.js14, 디자인 토큰, 전역 상태바+E-stop 바 | 빈 라우트 + 헬스 |
| **P1 인프라+텔레옵+플롯** | zenoh·autostart(SSH 포함)·시스템 모니터·201 토폴로지 / 텔레옵 묶음 / 토픽 동적구독·uPlot·joint_states·모터 온도 / controller switch·직접명령 | **즉시 목표 달성** |
| P2 명령+서브시스템 | publish/service/action 폼, subsystem manifest 로더, Swerve/Door 등 컨트롤 | 서브시스템 제어 |
| P3 테스트 런 엔진 | test 카탈로그·반복러너·선행과제·판정·기록 | 52테스트 실행 기반 |
| P4 전장부+진단+자산화 | BMS/Elyx 대시보드, diagnostics, CAN 진단·카운터, CSV/JSON, 스냅샷 | 자산화 완성 |
| P5 카메라/영상 | MJPEG/WebRTC 스트림·fps 플롯·USB허브 제어 | 카메라 테스트(25~27) |

---

## 12. 미해결 / 검증 항목 (구현 전·중 확인)
1. **라이브 인터페이스 실측** — 로봇 기동 후 joint_states/diagnostics/BMS/도어/컨베이어/암/카메라의 실제 토픽·타입·서비스·액션 캡처(현재 OFF, manifest 이름 플레이스홀더)
2. **201 시스템 stats 경로** — ROS2 토픽 발행 여부 / 없으면 SSH psutil fallback
3. **컨트롤러 직접 명령 인터페이스** — swerve/도어/옆문 토크[중력보상]·Hightorque 등 실제 명령 채널
4. **diagnostics 출처** — moteus/ZLAC/충전 diagnostics가 `/diagnostics`로 나오는지
5. **카메라 파이프라인** — 압축/대역폭/USB허브 제어 방식(역량 H)
6. **SSH 무인 인증** — 202→201 키 배치
7. **zenoh 단일성** — 202 라우터 1개, 201 클라이언트 모드 검증
8. **202 의존성 설치** — fastapi/uvicorn/asyncssh pip (06_environment_setup류 문서화)
```
