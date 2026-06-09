# w_robot_testbench — 설계 문서 (SSOT, v0.3)

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
| **D** | [**`docs/test-project-model.md`**](docs/test-project-model.md) | **"테스트 프로젝트" 데이터 모델·부팅/실행 라이프사이클·소유권 (v0.3 핵심)** |

> **v0.2 → v0.3 변경 (핵심 패러다임 전환)**
> - 아키텍처를 `profile`·`subsystem`·`test` **3종 분리 선언**에서 → **"테스트 프로젝트"라는 단일 사용자 저작 1급 객체**로 통합(부속 D). 사용자가 GUI로 런타임에 레이아웃·위젯·필요 프로세스를 저작한다.
> - 서버 **Clean-Slate 부팅 게이트 + owned-registry 단일 소유권 모델** 도입 → 프로세스 출처(provenance)를 차집합으로 확정.
> - **baseline 동적화** — 201 유무 등에 좌우, 빈 집합 허용, 초기 마법사 + 관리자 페이지로 수정.
> - **프리셋 개념 폐기** — `origin: builtin` 읽기전용 프로젝트 + 복제로 대체. 52테스트는 builtin 프로젝트로 제공.
> - **합/불 판정은 human-in-the-loop** — 자동 판정식 없음. 테스터가 직접 PASS/FAIL.
> - 네비를 기능중심 9개 → **프로젝트 중심**으로 축소.
> - (v0.1→v0.2에서: 잠정 스택 React+Vite 폐기→Next.js14+FastAPI 하우스 스택, 전역 E-stop·역량 레이어 도입은 유지)

---

## 1. 목표와 범위

### 1.1 최종 목표
- 라이브 토픽 plot(PlotJuggler 대체), 런타임 런치/노드 기동·종료, 토픽 새로고침
- 사용자 친화 publish/service/action, zenoh 라우터 상태·자동기동
- 시스템 모니터(CPU/네트워크/인터넷/온도), 원격머신(201) 상태·연결 토폴로지·런치 제어
- diagnostics 시각화, CSV/JSON 자산화, **UI 구성을 "테스트 프로젝트"로 저작·저장·재현**
- **하드웨어팀 52개 테스트(부속 B)를 수용할 수 있는 확장성** — 부속 B는 *구현 대상 목록이 아니라*, 이만큼 다양한 테스트를 **사용자가 테스트 프로젝트로 직접 구성**할 수 있어야 한다는 **확장성 요구의 참고자료**다(부속 D). 52테스트를 미리 구현·제공하지 않는다.

### 1.2 즉시 구현(P1) 범위
- 자동 순차기동 3대상(§2.3) + 텔레옵 묶음 + `joint_states`/모터 온도 플롯 + 컨트롤러 선택활성·직접명령
- (P1은 풀 **저작 UI** 이전 단계 — 미리 정의된 **builtin 텔레옵 프로젝트**를 실행해 수렴·기동·플롯·제어를 먼저 달성한다. 즉 프로젝트 실행 엔진의 최소 동작 검증. 자유 저작 UI는 이후 Phase. 로드맵 §11)

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

### 2.3 자동 순차 기동 3대상 (서버 기동 시) — baseline 후보(§4·부속 D §2.5)
```
① zenoh 라우터  (202 로컬)  : 미실행 시에만 → ros2 run rmw_zenoh_cpp rmw_zenohd
② robot urdf    (202 로컬)  : ros2 launch w_type_mm robot.launch.py      # robot_state_publisher
③ controller    (201 SSH)   : (export LC_ALL=C; source ~/colcon_ws/install/setup.bash;) ros2 launch w_type_mm control.launch.py
```
각 단계 헬스체크 통과 후 진행(순차·idempotent). ②는 `/robot_description` latched → ③ controller_manager가 구독(SSOT).
> v0.3: 이 3대상은 **고정 autostart가 아니라 동적 baseline의 기본 후보**다. 201 미사용 등 상황에 따라 baseline은 비거나 달라질 수 있다(부속 D §2.5.1).

### 2.4 실측 자산
- 컨트롤러: `joint_state_broadcaster`, `swerve_controller`(`w_swerve_controller/WSwerveController`), `update_rate 30Hz`, cmd_vel=`/swerve_controller/cmd_vel`
- 텔레옵: `w_robot_teleoperation`(`teleop_joy.launch.py`+`twist_mux.launch.py`)
- 전장부: `wireless_charging_manager`(`daly_bms_driver`/`elyx_rx_driver`/`wireless_charging_monitor`)
- 모터 텔레메트리(온도/전류/토크): `/diagnostics`(`diagnostic_msgs/DiagnosticArray`, hardware_id `can2:<id>`) — 실측
- **기존 하우스 자산**: 202의 `bt_execution_gui`(FastAPI+rclpy / Next.js14 풀스택). 패턴 계승 대상(부속 A §1.3).

---

## 3. 기술 스택 (확정 = bt_execution_gui 하우스 스택 계승)

| 레이어 | 채택 | 비고 |
|---|---|---|
| 백엔드 | **Python + rclpy + FastAPI + uvicorn** | executor 스레드 + asyncio. `ros_bridge`/`ws_manager` 패턴 계승 |
| 프론트 | **Next.js 14 (App Router) + TS + Tailwind + shadcn/ui** | `useWebSocket.ts`/`api/client.ts`/StatusPulse/EmergencyStopBar 계승 |
| 상태/폼 | zustand + react-hook-form + zod | **zod 폼 = publish/service/action·위젯 동적 폼**(부속 D §3.2) |
| 애니/아이콘 | motion + lucide-react | Toss풍 |
| 플롯(신규) | **uPlot** (client 컴포넌트 래핑) | bt_gui엔 없음. 경량·고성능 시계열 |
| 레이아웃 엔진(신규) | **그리드(드래그·리사이즈)** | 테스트 프로젝트 레이아웃 저작용. 부속 C 9안 승격 |
| API 타입 | openapi-typescript (`/openapi.json`→`types.gen.ts`) | bt_gui 동일 워크플로 |
| 영상(역량 H) | MJPEG/WebRTC (별도 파이프라인) | 텍스트 플롯과 분리 설계 |
| 원격(201) | 런치=SSH(asyncssh), 데이터=ROS2(zenoh) | 하이브리드 |
| 모니터 | psutil + `sensors`/`/sys/class/thermal` | 201 stats는 ROS2 우선, SSH fallback |
| 배포 | colcon package + systemd | 202에 pip 설치 선행 |

> **기성 도구(Foxglove/rosbridge/PlotJuggler/rqt) 미채택** — 프로세스 오케스트레이션·SSH·zenoh·프로파일을 못 함(부속 A §2). 커스텀 백엔드 불가피.

---

## 4. 아키텍처 — 테스트 프로젝트 중심

핵심 전환: Swerve/고정 카테고리에도, `profile`·`subsystem`·`test` 3종 분리에도 하드코딩하지 않는다. testbench의 중심 1급 객체는 **"테스트 프로젝트(Test Project)"** — 사용자가 GUI로 런타임에 저작하는 단위다. 상세 스키마·라이프사이클은 **부속 D**가 SSOT이며, 본 절은 아키텍처 관점의 요약이다.

### 4.1 공통 역량 레이어 (백엔드 구현 개념 — UI엔 비노출)
아래 레이어는 **백엔드 구현을 조직하는 개념**일 뿐, 사용자에게 메뉴로 노출하지 않는다. 사용자는 "레이어"가 아니라 "테스트 프로젝트"를 다루고, 프로젝트가 이 레이어들을 소비한다.
```
L0 인프라/오케스트레이션 : zenoh·baseline·프로파일 묶음·201 SSH + Clean-Slate 부팅 게이트
L1 안전                  : 전역 Emergency Stop + 범퍼/정지우선 훅
L2 텔레옵                : 조이스틱/cmd_vel 제어 위젯·런치 빌딩블록 (텔레옵도 프로젝트로 표현 — §4.2)
L3 측정·플롯 엔진        : 토픽/모터텔레메트리/센서/fps → uPlot 시계열 + WS 스트림
L4 명령 인터페이스       : publish/service/action 친화 폼(zod) — 위젯 동적폼(부속 D §3.2)
L5 테스트 런 엔진        : 수렴·preflight·반복(cycle)·시퀀스·수동 verdict (부속 D §4)
L6 데이터 자산화         : CSV/JSON·이벤트/끊김 카운터·verdict·sqlite 이력
L7 카메라/영상           : MJPEG/WebRTC 스트림·이미지뷰·USB허브 제어
```

### 4.2 중심 개념: 테스트 프로젝트 (요약 — 상세 부속 D)
- **정의**: 사용자 저작 1급 객체 = `layout`(위젯) + `processes`(필요 런치/노드) + `resources`(위젯에서 파생된 의존 리소스) + `policy` + `runner`(반복/시퀀스) + `record`(자산화·수동 verdict). `origin: user|builtin`, 복제 가능.
- **위젯**: 제어(`control.topic_pub`/`service`/`action`) · 플롯(`plot.topic`/`plot.system`) · 상태 · diagnostics · 영상. 각 위젯이 의존 리소스를 스스로 신고 → preflight 입력.
- **실행 = Desired-State 수렴 + Preflight + 라이브 렌더** (9단계 상태머신, 부속 D §4): `desired = baseline ∪ project.processes` 로 수렴(잔여는 사용자 승인 후 종료) → 의존 리소스 존재·발행 검증 → 부족하면 보강 루프 → 충족 시 레이아웃대로 라이브 렌더 → 종료 시 이 실행이 켠 것만 정리.
- **소유권**: 서버는 모든 ROS 프로세스의 **유일한 기동 게이트웨이**(Clean-Slate 부팅, 부속 D §2.5). 출처는 **owned-registry 차집합**으로 확정(baseline/project/ad-hoc/foreign, 부속 D §5).
- **부속 B 52테스트** = 구현 대상이 아니라 **확장성 검증용 참고자료**(이 다양성을 프로젝트로 표현 가능한가의 시금석). builtin 프로젝트는 52개가 아니라 **사용법을 보여주는 간단한 튜토리얼 1~2개**만 제공한다.
- **거의 모든 운영·테스트가 프로젝트로 표현된다**: 텔레옵(`teleop_joy`+`twist_mux` 런치 + 조이스틱/`cmd_vel` 위젯 + plot)도, 서브시스템 제어도 별도 고정 기능이 아니라 테스트 프로젝트의 한 형태다. 텔레옵은 가장 단순·상용이라 **첫 builtin 튜토리얼 프로젝트** 1순위 후보. → **플랫폼 고정 기능으로 남는 것은 인프라(baseline·zenoh·201)·시스템 모니터·전역 안전(E-stop)·프로젝트 관리(CRUD·실행) 셸뿐**이다.

### 4.3 백엔드 구성도 (수렴·소유권 반영)
```
[브라우저: Next.js] ⇄ REST/WS ⇄ [FastAPI 앱 (202)]
   ├─ ros_bridge      : rclpy Node + executor 스레드 (future→asyncio)
   ├─ ws_manager      : broadcast bus + welcome snapshot
   ├─ introspect      : 토픽/타입/서비스/액션 런타임 발견 (위젯 동적폼·preflight 입력)
   ├─ subscriber_pool : 동적 구독 → 스트림(L3)
   ├─ procman         : local subprocess + remote_ssh(201) + zenoh
   │                    + boot_gate(Clean-Slate) + owned_registry(소유권) + reconciler(수렴)
   ├─ project_store   : 테스트 프로젝트 CRUD (user=JSON / builtin=YAML) + 복제
   ├─ project_runner  : 수렴→preflight→라이브→cycle/sequence 구동 (부속 D §4)
   ├─ preflight       : 위젯 의존 리소스 존재·발행 검증 (self_check 확장)
   ├─ monitor         : psutil/sensors + 201 stats (L0, plot.system 공급)
   ├─ recorder        : CSV/JSON·counters·verdict (L6)
   └─ emergency       : 전역 E-stop (L1, 모터·액추에이터 정지 — 프로세스 kill과 별개)
```
> v0.2의 `manifest`/`self_check`/`test_runner`는 각각 `project_store`/`preflight`/`project_runner`로 승계·재편된다.

---

## 5. 레포 구조

```
w_robot_testbench/
├── DESIGN.md                       # 본 SSOT
├── docs/                           # 부속 A/B/C/D + (예정) 01~06 하우스 문서 체계
├── pyproject.toml                  # 백엔드
├── config/
│   ├── testbench.yaml              # 서버/머신/zenoh/liveness
│   ├── baseline.yaml               # 동적 baseline (관리자 페이지가 수정 · 빈 집합 허용 · 부속 D §2.5.1)
│   ├── projects/                   # 사용자 테스트 프로젝트 (JSON, 런타임 CRUD)
│   │   └── builtin/*.yaml          # 읽기전용 튜토리얼 프로젝트 (git-tracked, 예: teleop)
│   └── records/                    # 실행 결과 CSV/JSON·verdict (자산화)
├── backend/testbench/
│   ├── main.py                     # rclpy.init→Node+executor→project_store 로드→boot_gate→FastAPI→uvicorn
│   ├── ros/                        # node, introspect, subscriber_pool, publisher, service_action, controller
│   ├── procman/                    # local, remote_ssh, zenoh, boot_gate, owned_registry, reconciler
│   ├── projects/                   # store(CRUD/복제), runner(수렴→preflight→live→cycle/seq), preflight
│   ├── widgets/                    # 위젯 종류별 핸들러 + 의존리소스 파생 + 동적폼(타입 introspect)
│   ├── monitor/                    # local_stats, remote_stats (plot.system 공급)
│   ├── recorder/                   # csv/json, counters, verdict
│   ├── emergency.py                # 전역 E-stop
│   ├── ws_manager.py / ros_bridge.py
│   ├── api/                        # REST 라우터
│   └── ws/                         # WebSocket 핸들러
└── frontend/                       # Next.js 14
    └── src/
        ├── app/                    # 라우트: / (프로젝트 목록·홈), projects/[id] (편집·실행),
        │                           #         system (인프라·모니터), admin (baseline), data (자산)
        ├── components/             # StatusPulse, EmergencyStopBar, GridLayout, WidgetRegistry,
        │                           #   widgets/(ControlPub·ControlService·ControlAction·PlotTopic·
        │                           #   PlotSystem·StateView·Diagnostics·ImageView), ParamForm(zod)
        ├── hooks/                  # useWebSocket, useApi, useProjectRun
        ├── api/ lib/
```
> v0.2 대비: `config/profiles|subsystems|tests|snapshots` → **`config/projects/`(+`builtin/`)** + `baseline.yaml`로 통합. backend `manifest`/`runner` → **`projects/`(store·runner·preflight)** 로, `procman`에 **boot_gate·owned_registry·reconciler** 추가, **`widgets/`** 신설. frontend 9개 라우트 → **프로젝트 중심 5개**로 축소(§8).

---

## 6. 선언형 스키마 (요약 — 상세 부속 D)

v0.2의 3종(`profile`/`subsystem`/`test`)은 **테스트 프로젝트 단일 스키마**로 통합됐다. 본 절은 골격만 싣고, 위젯 카탈로그·동적폼·라이프사이클 등 상세는 **부속 D**가 SSOT다.

### 6.1 `testbench.yaml` (전역 설정)
```yaml
server: { host: 0.0.0.0, port: 8080 }
machines:
  server:     { host: 192.168.34.202, role: server }
  controller: { host: 192.168.34.201, ssh_user: ubuntu, ws: ~/colcon_ws,
                setup: "export LC_ALL=C; source ~/colcon_ws/install/setup.bash" }
zenoh: { router_cmd: "ros2 run rmw_zenoh_cpp rmw_zenohd", check: {method: process, match: rmw_zenohd} }
liveness: { controller_machine: { method: ping, host: 192.168.34.201, interval_s: 5 } }
boot_gate: { scan_ros_procs: true, on_existing: ask }   # Clean-Slate 부팅(부속 D §2.5)
```

### 6.2 `baseline.yaml` (동적 baseline · 관리자 수정 · 부속 D §2.5.1)
```yaml
baseline:                            # 빈 집합([]) 허용 — 201 미사용 등
  - { id: zenoh,      machine: server,     kind: run,    command: "ros2 run rmw_zenoh_cpp rmw_zenohd",
      skip_if_running: true, healthcheck: {type: process, match: rmw_zenohd} }
  - { id: robot_urdf, machine: server,     kind: launch, command: "ros2 launch w_type_mm robot.launch.py",
      healthcheck: {type: topic, topic: /robot_description} }
  - { id: controller, machine: controller, kind: launch, depends_on: [robot_urdf],
      command: "ros2 launch w_type_mm control.launch.py" }   # 201 SSH
```

### 6.3 테스트 프로젝트 (`config/projects/*.json` · builtin은 `builtin/*.yaml`)
부속 D §2의 스키마. 골격만 재게시:
```yaml
test_project:
  id / name / description
  origin: user                       # user | builtin(읽기전용)
  cloned_from: null                  # 복제 원본 id
  layout: { grid, widgets: [...] }   # 위젯(제어/플롯/상태/diagnostics/영상) — 부속 D §3
  processes: [...]                   # 필요 런치/노드 (= 구 profile)
  resources: { derived: true, require: [...] }   # 위젯에서 파생된 의존 리소스 + 보강
  policy: { exclusive: true, on_orphan: ask, cleanup_adhoc_on_stop: true }
  runner: { mode: manual|cycle|sequence, ... }   # 반복 내구성 등 (부속 D §2-E)
  record: { topics, export, counters, verdict: manual }   # 자산화 + 수동 합/불
```

> 예) **builtin 텔레옵 프로젝트**: `processes`=[teleop_joy, twist_mux], 위젯=조이스틱(`control`)·`cmd_vel`(state)·`joint_states`/모터온도(`plot`), `runner.mode: manual`. → §4.2의 "텔레옵도 프로젝트" 구현체이자 첫 튜토리얼.

---

## 7. API / WebSocket 계약 (요지)

### 7.1 REST
| 경로 | 기능 |
|---|---|
| `GET /api/system/status` | zenoh·202/201 연결("단독/함께")·CPU/온도/net |
| `GET /api/boot/status` · `POST /api/boot/resolve` | **Clean-Slate 게이트**: 잔존 ROS 프로세스 목록 / `{action: kill\|cancel}` (부속 D §2.5) |
| `GET·PUT /api/baseline` | 동적 baseline 조회·수정(관리자, 빈 집합 허용) |
| `GET /api/projects` · `POST /api/projects` | 프로젝트 목록 / 생성 |
| `GET·PUT·DELETE /api/projects/{id}` | 단건 CRUD (`origin: builtin`은 읽기전용) |
| `POST /api/projects/{id}/duplicate` | 복제(builtin→user 시작점) |
| `POST /api/projects/{id}/run` · `/stop` | 실행(수렴→preflight→live) / 정지·정리(provenance 기반) |
| `POST /api/projects/{id}/run/decision` | 실행 중 결정: orphan `kill\|keep\|abort`, 보강 후 재preflight |
| `POST /api/projects/{id}/verdict` | **수동 합/불·코멘트 기록**(L6, 자동 판정 없음) |
| `GET /api/topics?refresh=1` · `/{n}/type` · `/services` · `/actions` | 런타임 introspect(위젯 동적폼·preflight 입력) |
| `POST /api/publish` · `/service` · `/action` | 위젯 백킹 동적 명령(친화 폼) |
| `GET /api/controllers` · `POST /api/controllers/switch` | controller_manager |
| `GET /api/processes` | **owned-registry 조회 + 난입(foreign) 감지** |
| `POST /api/record/start\|stop?format=csv\|json` | 자산화(프로젝트 실행에 연동) |
| `POST /api/emergency/stop` | 전역 E-stop (모터·액추에이터 정지 — **프로세스 kill 아님**) |

> 구 `/api/profiles`·`/api/subsystems`·`/api/tests`·`/api/snapshots`는 **`/api/projects`로 통합·폐기**.

### 7.2 WebSocket `/ws`
- `welcome` 스냅샷 → 재접속 복원(ws_manager 패턴)
- `{op:"sub", topic, fields}` 동적 구독 → throttle/downsample → `{topic, stamp, values}` 브로드캐스트
- **프로젝트 실행 진행**: 상태머신 단계(`RESOLVE`→`SCAN`→`DIFF`→`START`→`PREFLIGHT`→`LIVE`…) push (부속 D §4)
- `confirm_required`(orphan 목록) / `report_missing`(미충족 리소스) 이벤트 → REST `run/decision`으로 응답
- 시스템 모니터·diagnostics·프로세스 상태·**난입 감지**·테스트 카운터·E-stop 이벤트 동일 채널 push

---

## 8. 메인 페이지 / UX (부속 C 합성 → 프로젝트 중심 재해석)

### 8.1 셸 (항상 노출)
- 좌측 **사이드바**(5개 네비, §8.2) + 상단 **전역 상태바**(StatusPulse: zenoh/201/CPU/온도) + **전역 Emergency Stop 바**(상시) + **⌘K 커맨드 팔레트**(보조)

### 8.2 네비 (프로젝트 중심 5개)
1. **홈** — 프로젝트 목록(카드) + 상태 요약 + 빠른 실행 (구 2안 대시보드 + 6안 그리드)
2. **프로젝트** — 편집 ↔ 실행 (핵심 화면, §8.3)
3. **시스템/인프라** — zenoh·202/201 모니터·CAN/네트워크·프로세스(owned-registry)·**난입 감지**
4. **관리자** — baseline 구성·부팅 게이트 정책 (부속 D §2.5.1)
5. **데이터 자산** — 실행 이력·CSV/JSON·verdict·카운터

### 8.3 프로젝트 화면 = 편집 ↔ 실행 (★ "2-트랙 모드"의 흡수)
초기에 논의한 **"운영/가이드 2-트랙"** 은 별도 모드 토글이 아니라 **프로젝트의 두 상태**로 자연 흡수된다:
- **편집(저작)**: 위젯 팔레트에서 제어/플롯/상태 위젯을 그리드에 배치 + `processes`(필요 런치) 정의 (구 9안 위젯보드)
- **실행**: ▶ 누르면 수렴→preflight를 **단계 스텝퍼(=가이드)** 로 보여주고(구 8안 위저드), 통과 후 저작한 레이아웃대로 **라이브 렌더(=운영 대시보드)** (구 3안 도킹 워크스페이스)

→ 사용자가 "가이드냐 운영이냐"를 **고를 필요가 없다.** ▶ 실행을 누르면 **가이드(수렴·점검)가 흐르고, 끝나면 운영(라이브)으로 이어진다** — 한 화면에서 연속. 신규자는 스텝퍼를 따라가고, 숙련자는 통과를 지켜본 뒤 바로 조작한다.

### 8.4 부속 C 10안 → v0.3 매핑
1안 사이드바 = 셸 / 2·6안 = 홈 / **9안 = 편집(레이아웃 빌더)** / **8안 = 실행 스텝퍼** / **3안 = 라이브 렌더·멀티플롯** / 5안 ⌘K = 전역 보조 / 10안 NOC = 시스템 페이지 옵션 뷰.

---

## 9. 역량 매핑 (부속 B §2 요약)
A 텔레옵 · B 모터 직접제어 · C 모터 텔레메트리 · D 액추에이터 구동 · **E 반복 내구성 러너** · F 센서/스위치 모니터 · G 충전/배터리 · H 카메라/영상 · I 도킹 · J CAN 진단 · K 자산화 · **L 안전(E-stop)**.
→ 백엔드 레이어 L0~L7 + **테스트 프로젝트(위젯·processes·runner·record)** 로 전부 수용. 부속 B는 *구현 대상이 아니라 이 수용력의 참고자료*(§4.2). 매핑 상세는 부속 B.

---

## 10. 안전 (L1)
- **전역 Emergency Stop**: UI 어디서나 1클릭. 모든 active goal cancel + cmd_vel 0 + 활성 액추에이터 정지(다중). `emergency.py` 패턴 확장.
- **불변식: E-stop ≠ 프로세스 kill** (부속 D §4) — E-stop은 모터·액추에이터를 멈출 뿐, baseline·실행 중 프로세스를 종료하지 않는다. 프로세스 종료는 수렴(reconcile)·정지(stop)의 책임.
- **범퍼 정지 우선**(테스트 30·32): 위젯의 `sensors_state.on_true: estop` 훅으로 선언.
- **파손 가능성** 테스트(17·19 등)는 프로젝트 메타 `damage_risk: true` → UI 경고.
- **Clean-Slate 부팅**(부속 D §2.5): 관리되지 않는 ROS 프로세스를 시작 시 정리해, 통제 밖 명령이 도는 상태를 원천 차단.

---

## 11. 로드맵
| Phase | 범위 | 산출물 |
|---|---|---|
| P0 스캐폴딩 | 레포 골격, FastAPI+rclpy(ros_bridge/ws_manager 이식), Next.js14, 디자인 토큰, 전역 상태바+E-stop 바, **boot_gate(Clean-Slate)** | 빈 라우트 + 헬스 + 부팅 게이트 |
| **P1 인프라 + 텔레옵 프로젝트** | 동적 baseline·zenoh·autostart(SSH)·시스템 모니터·201 토폴로지 / **builtin 텔레옵 프로젝트 실행**(수렴·preflight·라이브) / joint_states·모터온도 plot / controller switch·직접명령 | **즉시 목표 달성 + 프로젝트 실행 엔진 최소 검증** |
| P2 프로젝트 저작 UI | 레이아웃 빌더(그리드·위젯 팔레트), 위젯 **동적폼**(introspect), 프로젝트 CRUD·복제 | 사용자가 프로젝트 저작 |
| P3 수렴·preflight 완성 | reconciler(orphan 승인 종료)·preflight(존재·발행)·report_missing 보강 루프·owned-registry/난입 감지 | 완전한 desired-state 수렴 |
| P4 러너 + 자산화 | runner(cycle/sequence 반복)·record(CSV/JSON·counters·**수동 verdict**)·데이터 자산 페이지 | 반복 내구성·결과 박제 |
| P5 전장부 + 진단 + 카메라 | BMS/Elyx 위젯·diagnostics·CAN 진단·카운터 / MJPEG/WebRTC·fps·USB허브 | 전장부·카메라 위젯 |

---

## 12. 미해결 / 검증 항목 (구현 전·중 확인)
> **2026-06-09 1차 검증 완료** — 아키텍처 4대 구조 가정 + 보조 2개 전부 합격. 상세: [`docs/verification-2026-06-09.md`](docs/verification-2026-06-09.md).

1. **라이브 인터페이스 실측** — 로봇 기동 후 도어/컨베이어/암/카메라 등의 실제 토픽·타입·서비스·액션 캡처(현재 미확인, 위젯 `name` 플레이스홀더). *원칙: 카탈로그는 박제하지 않고 런타임 동적 발견.*
2. **201 시스템 stats 경로** — ROS2 토픽 발행 여부 / 없으면 SSH psutil fallback.
3. **컨트롤러 직접 명령 인터페이스** — swerve/도어/옆문 토크[중력보상]·Hightorque 등 실제 명령 채널. (cmd_vel = `geometry_msgs/Twist` **확정**, §2.4)
4. ✅ **diagnostics 출처(모터)** — `/diagnostics`(DiagnosticArray, hardware_id `can2:<id>`, key `temperature_C`/`current_A`/`effort_Nm`…) **검증**. → plot에 diagnostics 파서 필요. (충전/기타 출처는 미확인)
5. **카메라 파이프라인** — 압축/대역폭/USB허브 제어 방식(역량 H).
6. ✅ **SSH 무인 인증** — 202→201 키 배치 **완료**(2026-06-09). 제품 서버는 admin "201 연결 설정" 부트스트랩(비번 1회→copy-id→폐기, 영구저장 금지).
7. ✅ **zenoh 단일성** — 202 라우터 1개, 201 클라이언트(`connect tcp/202:7447`) **검증**. 202에서 201 노드 가시.
8. **202 의존성 설치** — fastapi/uvicorn/asyncssh pip (06_environment_setup류 문서화).
9. **부속 D 잔여**(§8) — 난입(foreign) 판별 패턴(launch 자식 프로세스 트리 추적 — 검증3에서 cmdline 패턴 확인), healthcheck↔preflight 폴러 통합, 발행 위젯 type 해석(introspection 검증 ✅). *합/불 판정식은 범위 밖으로 결정됨(수동 verdict)*.






