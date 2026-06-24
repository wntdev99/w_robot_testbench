# w_robot_testbench — Claude 조작 MCP 설계 (검토용 초안)

> 목적: 하드웨어팀이 **Claude 채팅으로** 로봇을 안전하게 조작/관측하도록, 기존 테스트벤치 백엔드(HTTP API)를 그대로 감싸는 **얇은 MCP 서버**를 정의한다. **백엔드 코드는 수정하지 않는다.**

## 1. 핵심 전제 (왜 이렇게 쉬운가)
- 제어/관측 동작이 **전부 REST + WebSocket**로 노출됨 (`backend/testbench/api/*`).
- 별도 인증 없음 — LAN 전제, CORS만 존재. MCP는 같은 LAN에서 `http://192.168.34.202:8080`(또는 dev `localhost:8080`)에 HTTP만 치면 됨.
- 서브시스템이 `config/subsystems/mobile_base.yaml`에 **controls / telemetry / safety**로 이미 구조화 → 그대로 MCP 도구로 사상(map) 가능.
- 따라서 MCP = "의도 단위 도구 이름 + 안전 가드"를 입힌 **HTTP 클라이언트**. 신규 ROS 로직 없음.

## 2. 아키텍처
```
Claude(채팅)
   │  MCP (stdio)
   ▼
w_robot_mcp  (TypeScript/Node, @modelcontextprotocol/sdk + ws)   ← 신규, .mcpb 번들
   │  HTTP(제어/관측 단발) + WS 상시구독(텔레메트리 → 링버퍼)
   ▼
testbench 백엔드 (FastAPI, 기존)         ← 무수정
   │  rclpy / zenoh / SSH
   ▼
로봇 (202 서버 / 201 컨트롤러)
```
> **🔒 전역 불변 규칙: 1차 전체가 백엔드 0줄 수정.** 모든 제어·관측·구독·테스트·무인반복·정지래치를 **기존 testbench HTTP/WS API + 별도 로드셀 API**로만 구현. 백엔드 수정이 거론됐던 두 곳(백엔드 래치 §15.7 / 무인용 백엔드 런 엔진 §10-7)은 **둘 다 1차에서 불필요**(MCP 측으로 해결). 백엔드 손대는 건 향후 선택지일 뿐.
- 배포: 서버(202)나 하드웨어팀 PC 어디서든 실행. 환경변수 `TESTBENCH_BASE=http://192.168.34.202:8080`로 대상 지정.
- 형태: stdio MCP 서버 1개, **TypeScript/Node**로 작성 → **`.mcpb` 번들**로 배포(§13). Claude Desktop이 Node 런타임 내장 → **사용자 PC에 런타임 설치 불필요·원클릭**. (Python으로도 가능하나 사용자 PC에 Python 설치 필요 → 비권장.)
- 의존성: `@modelcontextprotocol/sdk`, `ws`(WebSocket). 백엔드 base URL은 `.mcpb`의 `user_config`로 설치 시 UI 입력(JSON 편집 없음).
- 백그라운드 태스크: WS 수신 루프가 링버퍼를 갱신하고, MCP 도구 핸들러는 그 버퍼를 읽음. 도구 호출과 WS 수신은 독립적으로 동작.

## 3. 도구 목록 (제안)

### 관측 (read-only, 가드 불필요)
| 도구 | 매핑 API | 설명 |
|---|---|---|
| `get_system_status()` | `GET /api/system/status` | zenoh/201연결/CPU·온도 등 한눈 상태 |
| `list_topics()` | `GET /api/topics` | 라이브 토픽 목록 |
| `get_diagnostics()` | `GET /api/diagnostics` | 모터 온도/전류/토크/끊김 카운터 |
| `get_motor_status()` | `GET /api/diagnostics` (필터) | manifest의 `can2:*` 키만 추려 보기 좋게 반환 |
| `list_controllers()` | `GET /api/controllers` | controller_manager 상태 |
| `get_camera_frame(topic)` | `GET /api/camera/frame` | 단일 JPEG 프레임 (이미지로 반환) |
| `describe_command(kind,name)` | `GET /api/{topics,services,actions}/fields` | 폼 필드 introspection (Claude가 인자 모를 때) |

### 발견 (Discovery) — 무엇이 떠 있나 / 무엇이 뜰 예정인가
ROS 토픽·서비스·액션은 **노드가 떠 있을 때만 존재하는 런타임 산물**이다. 그래서 두 축으로 나눠 제공한다.

**(a) 라이브 발견 — 항상 fresh, 캐시 금지.** 백엔드가 매 호출마다 라이브 그래프를 새로 조회([topics.py:13](w_robot_testbench/backend/testbench/api/topics.py:13)). MCP는 토픽 목록을 **캐시하지 않고**, 제어 직전 재조회를 규칙으로 한다.
| 도구 | 매핑 | 설명 |
|---|---|---|
| `discover(kind)` | `GET /api/{topics,services,actions}` | 현재 라이브 전체 (kind=topic/service/action) |
| `whats_new(baseline?)` | 위 + diff | 직전 스냅샷/기대 카탈로그 대비 **새로 나타난·사라진** 항목 강조 ("런치 켰더니 뭐가 떴나") |

**(b) 기대 카탈로그 — 런치 전 미리보기.** 라이브 그래프에 없어도, 선언적 소스로 "이걸 켜면 무엇이 뜰지"를 답한다.
| 도구 | 소스 | 설명 |
|---|---|---|
| `list_expected_interfaces(subsystem?)` | `GET /api/subsystems` (manifest) | 서브시스템이 뜨면 나올 **기대 토픽/타입/서비스** + 필요한 `launch_profiles` |
| `list_launches(machine)` | `GET /api/launch/files` | 실행 없이 스캔한, 켤 수 있는 런치 목록(서버/201) — [discover.py:22](w_robot_testbench/backend/testbench/procman/discover.py:22) |
| `what_to_launch(interface\|subsystem)` | manifest 역매핑 | 원하는 토픽/서브시스템을 쓰려면 어떤 launch_profile을 켜야 하는지 |

**전형 흐름**: `list_expected_interfaces`(런치 전 기대치) → `what_to_launch` → `profile_up`(confirm) → `whats_new`(실제로 떴는지 라이브 확인) → 제어. 이 흐름이 "런치 안 켜면 토픽이 안 보인다" 문제를 정확히 메운다.

### 제어 — 저위험 (확인 없이 허용)
| 도구 | 매핑 API | 설명 |
|---|---|---|
| `drive(vx, vy, omega, duration_s, confirm?)` | `POST /api/publish` → `/swerve_controller/cmd_vel` (하트비트 5–10Hz) | **데드맨**: duration 동안 0.5s보다 빠르게 반복 발행, 종료 시 중단(+0 1회) → 컨트롤러 0.5s 타임아웃 자동 정지(§15). **속도 소프트캡**: 0.3 m/s↑·0.5 rad/s↑면 confirm(§4-1) |
| `stop()` | `POST /api/publish` (zero Twist) | 부드러운 정지(컨트롤러 유지) |
| `cancel_navigation()` | `POST /api/nav/cancel` | 진행 중 nav goal 취소 |

### 제어 — 고위험 (confirm 필수)
| 도구 | 매핑 API | 가드 |
|---|---|---|
| `emergency_stop()` | `POST /api/emergency/stop` | 항상 노출, 즉시 실행(이건 안전 동작) |
| `switch_controller(activate, deactivate)` | `POST /api/controllers/switch` | 모터 인가 → confirm |
| `send_nav_goal(x, y, yaw)` | `POST /api/action` → `/navigate_to_pose` | 주행 동반 → confirm |
| `run_launch(pkg, file, args)` / `stop_launch(id)` | `POST /api/launch/run` `/stop` | 프로세스 기동/종료 → confirm |
| `profile_up(id)` / `profile_down(id)` | `POST /api/profiles/{id}/{up,down}` | 묶음 기동 → confirm |
| `apply_startup_plan()` / `kill_all_ros2(scope)` | `POST /api/admin/{apply,kill}` | **파괴적** → 명시적 confirm + 경고 |

### 실시간 스트림 (1단계부터 포함 — WS 구독 우선)
MCP 서버가 기동 시 백엔드 `/ws`에 **클라이언트로 상시 연결**하고, 관심 토픽을 미리 `sub`해 **토픽별 링버퍼(최근 N초)** 에 적재한다. Claude가 물어볼 때 데이터가 이미 "웜" 상태이고, 추이/이력/이벤트도 답할 수 있다. (폴링이 아니라 구독을 기본으로 채택 — 근거는 §8.)

| 도구 | 동작 | 설명 |
|---|---|---|
| `get_latest(topic)` | 링버퍼 최신값 | 단발 스냅샷. cold-start 구독 대기 없음 |
| `get_recent(topic, seconds)` | 링버퍼 구간 샘플 | 시계열 원본 |
| `watch(topic, seconds)` | 구간 통계/추이 요약 | min/max/mean/추세 (예: "5초간 FL 전류 변화") |
| `list_watched()` | 현재 구독 중 토픽 | 버퍼 상태/마지막 수신시각 |
| `subscribe_topic(topic, type)` / `unsubscribe_topic(topic)` | 동적 구독 추가/해제 | 기본 토픽 외 임시 관심 토픽 |

- **기본 구독 세트**(기동 시 자동): `mobile_base.yaml`의 telemetry — `/joint_states`, `/swerve_controller/odom`, `/imu` + `diagnostics`(백엔드 상시구독이라 sub 불필요) + 이벤트(`estop`/`action_result`/`processes`/`system`).
- **링버퍼**: 토픽별 최근 N초(기본 30초) 또는 최대 샘플 수 상한. 메모리 바운드.
- **재연결**: WS 끊기면 백오프 재연결 + 재구독. `welcome` 스냅샷으로 상태 복원([ws_manager.py:34](w_robot_testbench/backend/testbench/ws_manager.py:34)).
- **레이트**: 백엔드가 토픽당 ~20Hz로 다운샘플([stream.py:36](w_robot_testbench/backend/testbench/ros/stream.py:36)). 더 촘촘히 필요하면 `config/testbench.yaml`의 `streaming.default_rate_hz` 상향(트래픽·CPU 증가 트레이드오프).

## 4. 안전 정책 (MCP가 코드로 강제)
1. **움직임 전면 승인(확정, 사용자 지시)**: `drive`는 **속도와 무관하게 항상 confirm 필수.** confirm 없이 호출하면 "어떻게 움직일지" 계획만 반환하고 **절대 안 움직임**. 하드 상한은 없고, `0.3 m/s`/`0.5 rad/s` 초과는 **추가 경고**(안전거리 환기)만 덧붙임.
2. **데드맨**: `drive`는 duration 동안 cmd_vel 하트비트(5–10Hz) 발행, 종료 시 중단 → 컨트롤러 0.5s 타임아웃이 자동 정지(§15). 무한 주행 도구 없음.
3. **confirm 게이트**: 고위험 도구는 `confirm=true` 인자 없이는 거부하고, 무엇이 일어나는지 설명 문자열 반환. (Claude가 사용자에게 1차 확인 → 재호출)
4. **E-stop 우선 + 인터록**: `emergency_stop`은 항상 즉시 실행, confirm 불필요. 정지 우선권·래치는 **§15에서 별도 설계**(가장 중요).
5. **파괴적 동작 차단 옵션**: `MCP_ALLOW_DESTRUCTIVE=0`이면 `apply_startup_plan`/`kill_all_ros2`를 아예 비활성.
6. **감사 로그**: 모든 제어 호출을 타임스탬프와 함께 파일 로그.

## 5. 제외/주의
- `auto_on_boot`(시작 플랜)는 파괴적이라 MCP 기본값에서 비활성 권장.
- 카메라 다중 동시 표시는 백엔드에서 3대 제한(429) — MCP는 에러를 그대로 전달.
- 201(컨트롤러) 대상 동작은 **키 기반 SSH** 선행 필요(README 0번 단계). 미설정 시 201 명령이 조용히 실패 → MCP가 `get_system_status`의 `ssh_ok`로 사전 경고.

## 6. 구현 규모 / 단계
- **1단계 (MVP, ~250줄)**: WS 상시구독 + 링버퍼(`get_latest`/`get_recent`/`watch`) + 관측 전체 + `drive`/`stop`/`emergency_stop`/`switch_controller` + confirm 게이트.
- **2단계**: nav goal / launch / profile / 시작플랜 + 동적 구독(`subscribe_topic`) + `watch` 추세 요약 고도화.
- 백엔드 무수정. 테스트는 백엔드를 dev로 띄우고(`--port 8099`) MCP를 붙여 도구별 호출 + WS 버퍼 적재 검증.

## 7. 파라미터 결정 (확정/권장)
1. ✅ **속도**: 하드 상한 없음 + **0.3 m/s·0.5 rad/s 이상 confirm**(§4-1).
2. ✅ **파괴적 동작**(시작플랜/kill): **기본 비활성**(`MCP_ALLOW_DESTRUCTIVE=0`), 관리자만 켜기. 단 로봇 기동에 필요한 `profile_up/down`·`launch run/stop`은 **포함(confirm)**.
3. ✅ **MCP 위치**: 모델 A(각 PC 로컬 stdio, .mcpb).
4. ✅ **링버퍼**: **30초 @ 20Hz**(메모리 미미). 긴 내구성 기록은 링버퍼 아닌 백엔드 recorder(CSV).

## 8. 실시간: WS 구독 채택 근거 + 레이턴시
**폴링이 아니라 WS 상시구독을 기본**으로 한다. 레이턴시를 줄이기 위해서가 아니라(아래 참고), 웜 데이터·이력·이벤트 포착을 위해서다.

- **파이프라인 레이턴시 (로봇→MCP 링버퍼)**: 추정 ~10–60 ms (중앙값 ~50ms). 20Hz 다운샘플([stream.py:36](w_robot_testbench/backend/testbench/ros/stream.py:36))이 지배적이고 zenoh/asyncio/LAN은 각 수 ms.
- **Claude 체감 레이턴시 (로봇→답변)**: LLM 턴(수 초)이 지배적이라 위 파이프라인 50ms는 사실상 무시됨. 즉 구독/폴링 간 *체감 속도* 차이는 없음.
- **그럼에도 구독을 쓰는 이유**:
  1. **웜 데이터** — 호출 시 cold `sub` 후 첫 메시지 대기(수십~수백 ms)가 없음.
  2. **이력/추이** — `get_recent`/`watch`로 시계열 질문 응답 가능(폴링 불가).
  3. **이벤트 포착** — estop/action_result/스파이크를 폴링 간격 사이에 놓치지 않음.
- **실측 TODO**: 로봇 환경에서 ROS 메시지에 타임스탬프를 찍어 종단 지연을 실측해 위 추정치를 갱신.

---

## 9. 테스트 오케스트레이션 + 설계 자문 (하드웨어팀 비개발자용)
목표: HW 구성원이 **자연어로 테스트를 설계**하면 Claude가 ① 실행 가능한 **테스트 플랜**으로 구조화하고, ② **설계를 비평/보완**하고, ③ 안전하게 **실행(또는 단계 가이드)** 하고, ④ 결과를 **리포트**로 박제한다. (이는 `docs/hardware-test-mapping.md`가 예고한 **L5 테스트 런 엔진 + 선언형 테스트 카탈로그**의 MCP 구현체다.)

### 9.1 핵심 제약 — 테스트는 3종 스텝의 혼합
옆문 내구성처럼 실제 HW 테스트는 로봇 단독으로 끝나지 않는다. 스텝을 3종으로 모델링한다.
| 스텝 종류 | 누가 실행 | MCP 동작 |
|---|---|---|
| **robot_action** | 로봇 | MCP가 제어 도구로 직접 실행 (drive/door/switch_controller…) |
| **manual_step** | 사람 | MCP가 **지시문 출력 → 사람 완료/관측 입력 대기** (골프백 적재, 힘 가하기, 파손 육안확인) |
| **measurement** | 계측 | 링버퍼/diagnostics 캡처(로봇 내부) + **로드셀 등 외부계측 값 입력**(별도 시스템) |

→ 그래서 MCP는 "자동 실행기"가 아니라 **사람·로봇·계측을 엮는 진행자(orchestrator)**. 로봇이 못 하는 단계(무게 적재, 힘 인가)는 사람에게 명확히 지시하고 관측값을 받는다.

### 9.2 두 실행 모드 (사용자 요청 1)
- **가이드 모드 (guide)** — 각 스텝을 사람이 읽고 따라 하도록 **번호·체크리스트로 안내**. 로봇 동작 스텝도 "지금 실행할까요?" 확인 후 실행. 비개발자 기본값·안전.
- **자동 모드 (auto)** — robot_action/measurement는 MCP가 **연속 실행**, manual_step에서만 멈춰 사람을 기다림. 반복 사이클(예 100/1000회 여닫기, 역량 E)에 유용. 고위험·파괴적 스텝은 confirm 게이트 유지.

### 9.3 설계 자문 기능 (사용자 요청 2)
`review_test_plan(plan)` — Claude가 평가위원/안전담당 관점으로 초안을 비평하고 보완안을 돌려준다. **단순 채점이 아니라, 실행 전에 알아야 할 선행조건·주의점·우려지점을 선제적으로 표면화**한다. 점검 축:
1. **선행 테스트/조건 (prerequisites)** — 이 테스트 전에 끝나야 할 것이 있나? (예: 옆문 구동 정상[No.22]·잠김 기능 확인이 내구성 가압[No.19]보다 먼저. 보정 안 된 로드셀로 힘 측정 금지 → 영점·스팬 선행.) 미충족 시 **실행 차단** 권고.
2. **주의점 (cautions)** — 사람·장비 안전, 장비 점유 충돌(예 로드셀 Control Panel 닫기), 모터 과열, 하중 낙하, 가압 중 손 끼임 등 **실행 중 챙길 것**을 체크리스트로.
3. **우려지점 (concerns/risks)** — 설계가 놓친 실패모드. "파손"이 정성적이라 재현 불가, 가압 힘의 방향/접촉면 미정의, 급출발정지의 가속도 미규정, 턱 3cm 진입각 미정 등 **결과 신뢰성을 흔들 요소**.
4. **안전 훅** — damage_risk 스텝에 E-stop·격리·인원보호 명시됐나? 모터 인가 전 confirm·속도상한?
5. **측정 충분성** — "파손 여부"를 무엇으로 판정? 육안만인가, effort/current 한계선·로드셀 수치·마이크로스위치 상태 같은 **정량 지표**가 붙었나?
6. **합·불 기준(pass/fail)** — 각 스텝에 명시적 판정 기준이 있나? (예 effort_Nm < X, 잠김스위치 = engaged)
7. **재현성** — 속도/하중/힘/반복횟수/정착시간이 수치로 고정됐나? 순서 의존·환경(점자블럭/턱 높이 3cm) 정의?
8. **인터페이스 가용성** — 필요한 토픽/서비스가 실재하나? (`list_expected_interfaces`로 대조, 미실측이면 라이브 확인 TODO 표기)

출력은 "지적 → 근거 → 보완 제안 → (수정 시) 갱신된 plan". 차수별 재리뷰로 개선 추적(= grant-review와 동일 철학). §9.8에 옆문 테스트 실제 자문 예시.

### 9.3ب 스냅샷을 테스트 빌딩블록으로 (재구성 모델)
사용자가 이미 필요한 화면을 **스냅샷으로 다 만들어 둠**(옆문/뒷문 제어, 모터 전류, 텔레옵+카메라, Usbhub, Navigation 등). 따라서 테스트 레이어는 화면을 새로 만들지 않고 **기존 스냅샷을 테스트별로 재구성(합치기)** 한다.
- MCP 도구: `list_views`(목록)·`get_view`(패널 구성 조회)·`compose_view`(여러 스냅샷 패널을 합쳐 테스트용 새 스냅샷 생성+열기)·`save_view`·`delete_view`·`open_view`.
- 테스트 정의는 "필요한 소스 스냅샷 목록 + 로봇 스텝 + 녹화 + 관측"으로 표현 → `compose_view`로 모니터 화면을 한 번에 구성하고, MCP가 스텝을 진행.
- 예: 옆문 내구성 → `compose_view("옆문내구성", ["1층 옆문 제어","모터 전류 확인","텔레옵+카메라"])` → 도어 제어+모터전류+카메라가 한 화면 → 사람이 보며, MCP가 주행/도어 스텝·녹화·관측 수집.

### 9.3ج 노션 기반 테스트 SOP (표준 절차 — 박제됨)
테스트의 원본 정의는 **노션 페이지**다(실험 방법=스텝, 정량 목표=합불, 기대 vs 실제 표=채울 결과). 그래서 모든 테스트는 **노션 페이지를 받아 시작**한다. 이는 **두 MCP를 Claude가 잇는 워크플로우**(노션 MCP 읽기/쓰기 + w_robot MCP 제어) — Claude Desktop에 둘 다 연결 전제. MCP `instructions`와 `test_sop` 도구에 박제됨.
```
1. 사용자가 노션 URL 제공 → notion-fetch로 읽음
2. 추출: 실험 방법(스텝)·정량 목표(합불)·기대 vs 실제 표(채울 칸)
3. review_checklist 적용 → 선행조건·주의·측정충분성 합의
4. save_test_plan(notion_url 포함) → start_test_run (+필요시 compose_view)
5. w_robot 원자 도구로 스텝 실행(로봇 동작은 매번 승인) → record_measurement/observation
6. finish_test_run → 리포트(MD/JSON/CSV)
7. 결과를 노션에 되돌려쓰기(승인 후): 실제결과 칸 + 상태 + 요약 댓글
```
- `save_test_plan`에 `notion_url` 필드 추가 → M4 계획↔노션 원본 연결. start_test_run/리포트에 표기.
- 노션 등 외부 쓰기는 **사용자 명시 승인 후에만**(자동모드 분류기가 무단 외부쓰기 차단 — 실측 확인).
- 검증: USB 허브 페이지(#27)로 읽기·댓글·페이지 하단 계획 추가 성공. 라이브 측정(6대 Gemini, USB 3.2)이 페이지 기대표와 일치.

### 9.4 도구 (제어 도구 위에 얹는 테스트 레이어)
| 도구 | 설명 |
|---|---|
| `draft_test_plan(자연어)` | 자연어 → 선언형 plan(아래 §9.6) 초안. 스텝 종류 자동 분류 |
| `review_test_plan(plan)` | §9.3 설계 자문 |
| `run_test(plan, mode)` | 가이드/자동 실행. 스텝별 진행·확인·관측수집 |
| `record_observation(step, value)` | 사람 관측(파손 Y/N, 로드셀 kg, 스위치 상태) 입력 |
| `finish_test(run_id)` | 결과 리포트(스텝별 측정·관측·합불·텔레메트리 구간) 생성·저장 |

### 9.5 백엔드 처리 위치 (사용자 요청 1의 "백엔드 직접 실행")
plan 실행은 **MCP 클라이언트 측에서** 기존 제어 API를 호출하는 것으로 충분(백엔드 무수정 유지). 단 **무인 반복 내구성(1000회)** 처럼 사람 개입 없이 장시간 돌려야 하는 경우만, 추후 백엔드에 `config/tests/*.yaml` + 런 엔진을 추가하는 2단계 선택지로 둔다(hardware-test-mapping §3.3 형식 그대로). 1단계는 MCP 오케스트레이션으로 시작.

### 9.6 워크드 예시 — 옆문 내구성 (No.19/22)
> 도어 서브시스템 manifest는 **아직 없음**(현재 mobile_base만). 아래는 스냅샷 실측 토픽 기반 초안이며, 솔레노이드/마이크로스위치 토픽은 **라이브 발견 필요(⚠)**.
```yaml
test:
  id: side_door_durability
  subsystem: door            # ⚠ manifest 미존재 → 생성 필요(door.yaml)
  damage_risk: true
  pass_fail: "각 스텝 파손 없음 + door effort 한계 이내 + 잠김/스위치 정상"
  steps:
    # 1) 하중 주행 (게걸음/급출발정지/턱3cm/점자블럭)
    - { kind: manual,  text: "골프백 10kg 적재" }
    - { kind: measurement, capture: [/joint_states(door_s1 effort), /diagnostics] , window_s: 후속주행 전체 }
    - { kind: robot,   action: drive, profile: crab,        vy: 0.2, duration_s: 5 }
    - { kind: robot,   action: drive, profile: start_stop,  vx: 0.3, pulses: 5 }
    - { kind: manual,  text: "턱 3cm 넘기 / 점자블럭 구간 주행 (수동 조작 또는 텔레옵)" }
    - { kind: manual,  text: "옆문 파손 육안 확인", observe: "damage(Y/N)+사진" }
    - { kind: manual,  text: "하중 20kg, 30kg 로 반복" }            # 10kg 단위 30kg까지
    # 2) 도어 90도 Open→Close + 솔레노이드/잠김/마이크로스위치
    - { kind: robot,   action: door, cmd: open, name: /door_s1_controller/command }   # std_msgs/String "open"
    - { kind: measurement, capture: [/joint_states(door_s1 effort/position)], check: "솔레노이드·마이크로스위치 ⚠라이브발견" }
    - { kind: robot,   action: door, cmd: close }
    - { kind: manual,  text: "잠김 기능·마이크로스위치 인지 정상 확인", observe: "lock=engaged?, switch=ok?" }
    # 3) Open 상태 윗면 하향 가압 (10/20/30/40kg) — 로드셀 계측
    - { kind: robot,   action: door, cmd: open }
    - { kind: manual,  text: "윗면을 중력방향으로 10kg 가압 (로드셀)", observe: "loadcell_kg + damage(Y/N)" }
    - { kind: manual,  text: "20/30/40kg 반복" }
    # 4) 끝까지 연 상태에서 더 여는 방향 15kg 가압
    - { kind: manual,  text: "완전 개방 후 추가 개방방향 15kg 가압 (로드셀)", observe: "loadcell_kg + damage(Y/N)" }
  record: { export: [csv, json], telemetry: [/joint_states, /diagnostics] }
```

### 9.7 이 테스트가 드러낸 갭 (구현 전 확정 필요)
- **도어 manifest 부재** — `config/subsystems/door.yaml` 생성 필요(제어 `/door_s1_controller/command`, 텔레메트리 `joint_states[door_s1]`). 솔레노이드/마이크로스위치 토픽은 라이브 발견으로 채움.
- **로드셀 통합 — 별도 설치 + 초기 인식(확정).** 사용자가 로드셀(`01_loadcell/loadcell_server.py` + Phidget 드라이버)을 **별도로 설치·기동**한다(MCP에 포함하지 않음). MCP는 **기동/preflight 시 로드셀 서버 도달성을 감지**(`GET /api/state`/`/api/reading`) → 연결되면 가압 시점에 `/api/reading`으로 **자동 캡처**, 미연결이면 **수기 입력 폴백** + "로드셀이 안 보여요, 켜셨나요?" 안내. 도구: `loadcell_status`(연결/보정 상태), 캡처는 measurement 스텝에서 자동.
  - 연결 위치: 로드셀 서버가 `127.0.0.1:8765` 바인딩이면 MCP가 같은 PC일 때 도달. 다른 PC면 사용자가 서버를 `0.0.0.0` 노출(설치 시 안내). MCP의 로드셀 base URL은 `.mcpb` user_config로 입력(기본 `http://localhost:8765`).
- **수동 스텝 비중이 큼** — 적재·가압·육안확인은 로봇이 못 함. MCP의 가치는 "자동화"보다 **절차 강제 + 정량 기준 + 관측·텔레메트리 동기 기록**에 있음.

### 9.8 워크드 예시 — 옆문 테스트 자문 (review_test_plan 출력 미리보기)
위 §9.6 plan을 자문하면 나올 핵심 지적(데모):

**선행 테스트/조건**
- No.22(옆문 구동: 모터 전류·토크·솔레노이드·스위치 정상)가 **No.19 가압 내구성보다 먼저** 통과돼야 함 — 구동이 비정상인데 가압하면 원인 분리 불가.
- 테스트 3·4 전 **로드셀 영점(tare)+스팬 보정 필수**(`POST /api/tare`). 보정 안 된 값은 무의미.
- 테스트 1은 **하중 적재 전 무하중 기준주행(대조군)** 을 먼저 떠야 effort 증가분을 판정 가능.

**주의점**
- 로드셀 PC에서 **Phidget Control Panel 닫기**(장치 점유 충돌 — README 명시).
- 가압(테스트 3·4) 시 **문 급落·손 끼임** 위험 → 가압 지그/장갑, 인원 손 위치 고지.
- 도어 모터 **연속 여닫기 과열** → diagnostics `temperature_C` 모니터 + 한계 도달 시 휴지.
- 주행 중 골프백 **낙하/이동** → 고정 상태 재확인 스텝.

**우려지점 (결과 신뢰성)**
- "파손 여부"가 정성적 → **정량 기준 부재**. 보완: door effort_Nm 상한선, 가압 후 잠김 토크/스위치 상태, 육안은 사진+체크리스트로 표준화.
- **급출발·급정지의 가속도 미규정** → 재현 불가. 보완: 목표 가속도/정지거리 수치화.
- **턱 3cm 진입각·속도, 점자블럭 방향** 미정 → 조건 고정 필요.
- 가압 **힘의 접촉점/방향**(윗면 중앙? 모서리?) 미정 → 파손 재현성 좌우.
- 하중 10/20/30kg, 가압 10/20/30/40kg에서 **각 단계 합·불 기준과 중단 조건**(파손 시 다음 단계 진행 여부) 미정.

**측정/합불 보완 제안**
- 각 스텝에 pass/fail: 예) "door effort_Nm ≤ 기준×1.3", "Close 후 마이크로스위치=engaged", "가압 후 재개폐 정상".
- 기록 대상: `/joint_states[door_s1]`(effort/position), `/diagnostics`(도어모터 온도/전류 — ⚠토픽 라이브확인), 로드셀 kg, 스텝별 사진.

## 10. 테스트 레이어 파라미터 (확정/권장)
5. ✅ **실행 기본 모드**: **가이드 기본**(비개발자), 자동은 반복 내구성에 옵트인.
6. ✅ **로드셀**: 사용자 별도 설치 + MCP 초기 인식(`loadcell_status`/preflight), 연결 시 자동캡처·미연결 시 수기 폴백(§9.7).
7. **무인 반복 내구성**(100/1000회) — ✅ **백엔드 수정 없이** 1단계 MCP가 처리: MCP **자체 백그라운드 루프**가 기존 API(publish/service)를 반복 호출해 사이클 자율 수행(+하트비트+스텝별 래치확인). 제약은 백엔드가 아니라 **Claude Desktop 세션 유지**뿐. 세션 없이 서버에서 돌리고 싶을 때만 **2단계 백엔드 런 엔진(순수 선택)**. ← 1차는 MCP로 확정
8. ✅ **리포트**: **CSV(원시 텔레메트리) + JSON(plan+결과 구조화) + Markdown(사람 요약)**, 사진은 파일경로 참조, 한 폴더 박제.

> **✅ 전 파라미터 확정 완료 (2026-06-24). M0 착수.**

---

## 11. 사용성·도입 설계 (비개발자 HW팀이 잘 쓰게 하려면)
기술적 가능 ≠ 실제 채택. "프로그래밍·터미널을 안 다루는 분"([USER_GUIDE.md](USER_GUIDE.md) 전제)이 **혼자서 두려움 없이** 쓰게 하는 것이 목표. 채택을 좌우하는 순서대로:

### 11.1 프리플라이트 점검 — 최대 레버 (1순위)
비개발자가 가장 막히는 지점은 "토픽이 안 보여요/안 움직여요"의 **원인 진단**이다. 모든 테스트·제어 전에 `preflight()`가 자동 점검 후 **사람 말로** 보고:
- 로봇 켜졌나(zenoh) · 201 연결됐나(ssh_ok) · 필요한 런치 떠 있나 · **로드셀 서버 도달·보정됐나**(별도 설치본, `loadcell_status`) · estop 래치 상태.
- 미충족 시 **다음 행동을 제시**: "컨트롤러(201)가 꺼져 있어요 → '_autostart 켜줘'라고 말해보세요." (스택트레이스 금지)

### 11.2 의도 언어 + 안전 기본값 + 가이드 기본 (2순위)
- 도구는 **테스트 목적 언어**: `open_door()`, `drive_crab(속도,시간)`, `emergency_stop()` — `publish(topic,type,data)` 같은 ROS 내부를 노출하지 않음(원하면 고급 도구로).
- **항상 안전 기본값**: 속도 클램프, 데드맨 자동정지, 고위험은 confirm, E-stop 상시.
- **가이드 모드 기본**: 단계별 한국어 안내 + "지금 실행할까요?" 확인 + 관측 입력 유도(§9.2).
- **드라이런**: "실제로 안 움직이고 무엇을 할지만 보여줘" 옵션 → 신뢰 형성.

### 11.3 명명된 테스트 카탈로그 + 메뉴 (3순위)
- 빈 화면 공포 제거. `list_tests()`로 **이름으로 된 테스트 목록**(52개 기반, hardware-test-mapping) 제시 → "옆문 내구성 테스트 시작"처럼 **이름만 부르면 시작**.
- 기존 워크스페이스 스냅샷(`config/snapshots/*`: "1층 옆문 제어" 등)처럼, 자주 쓰는 plan을 **저장·재호출**(`save_test`, 재실행). 동료가 남의 테스트를 그대로 재현 가능.
- `help()` / "뭐 할 수 있어?" → 평이한 능력 설명 + 예시 문구.

### 11.4 사람 말 오류 + 다음 행동 (4순위)
백엔드 에러코드를 사람 말로 번역: 404(토픽 미발견)→"아직 그 기능이 안 켜졌어요", 503(controller_manager)→"컨트롤러가 안 떴어요", 429(카메라 3대 초과)→"카메라를 너무 많이 켰어요", ssh 실패→"201에 연결이 안 돼요(키 설정 필요)". **항상 '그래서 뭘 하면 되는지'를 덧붙임.**

### 11.5 일관된 행동을 만드는 MCP instructions (페르소나)
MCP 서버 설명/시스템 프롬프트에 명시: "비개발자 HW 엔지니어를 돕는다. 전문용어 대신 테스트 목적 언어. 위험·파괴적 동작은 반드시 확인. **모르면 추측하지 말고 발견 도구로 라이브 확인.** 토픽 목록은 캐시하지 말고 제어 직전 재조회." → Claude 행동이 사람마다 들쭉날쭉하지 않게.

### 11.6 진입 마찰 제거 (배포)
- **중앙 배포 권장**: MCP를 서버(202)에 상주시키고 팀원은 **준비된 접속 설정만** 받기(각자 IP·SSH·설치 안 함). §7.3 결정과 연결.
- **퀵스타트 1장**: USER_GUIDE의 "30초 요약"처럼, **그대로 말하면 되는 예시 문구** 카드. 예) "시스템 상태 보여줘" · "옆문 열어" · "골프백 싣고 게걸음 5초" · "비상정지" · "옆문 내구성 테스트 시작".

### 11.6b 기존 프론트엔드와 유기적 통합 (별도 UI 안 만들기)
MCP와 프론트엔드는 **둘 다 같은 백엔드의 클라이언트** → 같은 `/ws`·같은 상태를 공유. MCP로 estop/주행/녹화를 하면 백엔드 브로드캐스트로 **프론트 화면(E-stop 바·플롯·카메라 패널)에 자동 반영**된다. 이미 유기적으로 연결됨.
- 그래서 시각적 인터랙션은 **기존 프론트엔드 재사용**(중복 UI 금지). 워크스페이스는 `?snapshot=<이름>` 딥링크 지원([workspace/page.tsx](frontend/src/app/workspace/page.tsx)) → MCP의 `open_view`/`open_camera_view`가 저장된 화면(Camera·Usbhub·Teleop·Navigation·옆문 제어 등)을 브라우저로 직접 연다.
- 역할 분담: **사람 시각/조작 = 프론트엔드**(카메라 라이브·다중선택, USB허브 카메라 전원 on/off는 `Usbhub` 화면, 텔레옵), **Claude 제어/분석/자동화/테스트 = MCP**.
- `get_camera_frame`은 Claude가 프레임을 받아 분석/리포트할 때만(사람 라이브 뷰는 프론트). 폐기한 것: 자작 camera.html(프론트 카메라 패널이 우월).
- `stop.html`은 SPA 의존 없는 **최소 안전 백업**으로만 유지(주 정지 UI는 프론트 E-stop 바 + MCP emergency_stop).

### 11.7 결과 공유·인수인계 (마무리)
- `finish_test`가 **마크다운 요약 + CSV/JSON + 사진 경로**를 한 폴더에 박제 → 관리자/동료에게 그대로 전달.
- 합·불·측정·관측·텔레메트리 구간이 한 리포트에 → "내가 한 테스트"를 남이 검증·재현 가능.

### 11.8 우선순위 요약
| 순위 | 항목 | 없으면 생기는 일 |
|---|---|---|
| 1 | 프리플라이트 점검 + 사람 말 오류 | "안 돼요"에서 멈추고 개발자 호출 |
| 2 | 의도 언어 + 안전 기본 + 가이드 | 무서워서 안 씀 / 사고 위험 |
| 3 | 명명된 카탈로그·저장·메뉴 | 뭘 할지 몰라 안 씀 |
| 4 | 중앙 배포 + 퀵스타트 카드 | 설치 단계에서 이탈 |
| 5 | 공유 리포트 | 결과 신뢰·인수인계 안 됨 |

---

## 12. 환경 전제 (다른 사람이 쓰기 위한 설치/설정)
> ⚠ **솔직한 비교**: 웹툴은 "브라우저로 `http://192.168.34.202:8080` 접속"이 전부(설치 0). **MCP 경로는 그보다 무겁다** — 최소 ① Claude 클라이언트 ② 로봇 LAN 접속이 필요. 무엇을 어디에 까느냐는 **배포 모델**(아래)로 갈린다.

### 12.0 ⚠ 네트워크 제약 — 카메라 ON 시 인터넷 단절 (실측)
노트북이 **로봇 Wi-Fi 하나로 LAN+인터넷**을 받는 환경에서, **카메라를 켜면 공유기 포화로 노트북 인터넷이 끊김** → Claude(클라우드 LLM)도 멈춤. 카메라 OFF면 복구. MCP↔로봇은 LAN이라 무관하지만 **Claude 호출 자체가 인터넷 필요**.
- **근본 해결**: 노트북 인터넷을 **별도 경로**로(휴대폰 USB 테더링/이더넷/USB Wi-Fi 동글). 라우팅: `192.168.34.x`=Wi-Fi(직접연결 서브넷), 기본경로=테더링. 그러면 카메라 ON에도 Claude 유지. (맥은 내장 Wi-Fi 1개라 두 번째 인터페이스 필요. 테더링 데이터 없으면 아래.)
- **데이터/장비 없을 때 — 시간차 워크플로우(채택)**: 세팅·자동화는 Claude(카메라 OFF) → 카메라 구간은 **브라우저 웹툴(로컬 LAN, 인터넷 불필요)** 로 보기 → 끄면 Claude 복귀.
- **안전판 `camera_on_temporarily(seconds)`**: Claude가 온라인일 때 호출 → MCP가 로컬에서 카메라 ON→N초 대기→**자동 OFF(인터넷 복구)**. 인터넷 끊긴 동안도 MCP는 로컬이라 끝까지 실행 → "못 끄고 영영 단절" 사고 방지. 그 사이 영상은 미리 띄운 웹툴로. (`open_camera_view`로 먼저 띄움)
- `review_test_plan`은 카메라 사용 스텝에 이 단절 경고를 포함.

### 12.1 공통 전제(모든 사용자)
- **로봇 Wi-Fi/LAN 접속**: PC가 `192.168.34.x` 망에 있어 서버(202:8080)에 닿아야 함(웹툴과 동일 조건).
- **Claude 클라이언트**: 비개발자는 **Claude Desktop**(Win/Mac GUI) 권장. Claude Code(터미널)는 비개발자에 부적합.
- **로봇이 켜져 있어야** 토픽이 보임(런치 전엔 라이브 토픽 없음 — §3). preflight가 이걸 점검.

### 12.2 배포 모델 — 이게 Windows에 뭘 까는지를 결정
> ⚠ **정정(검증 결과)**: Claude **Desktop**에는 원격 MCP를 URL로 붙이는 내장 UI가 **없다**(그건 claude.ai 웹 기능, 게다가 **HTTPS 강제 → LAN plain-http IP 거부**). 따라서 "Desktop + URL 한 줄, 설치 0"은 **불가**. Desktop이 직접 붙일 수 있는 건 **stdio 로컬 명령**뿐 → 원격 202에 붙이려면 각 PC에 **stdio↔HTTP 브리지(`mcp-remote`, Node.js 필요)** 가 있어야 한다.

**모델 B(중앙 서버 + 얇은 브리지, 권장)**: MCP **로직·도구·테스트카탈로그·업데이트는 전부 202에 1회 상주**(Streamable HTTP 엔드포인트, 예 `http://192.168.34.202:8765`). 각 PC엔 **Claude Desktop + Node.js + 준비된 `claude_desktop_config.json`(mcp-remote가 202를 가리킴)** 만 **1회** 설정. → 무거운 로직/ROS/Python은 PC에 없음(202에만). 도구·테스트 추가/수정은 **202에서만** 하면 전원 반영.

**모델 A(로컬 stdio MCP)**: 각 PC에서 **얇은 MCP 본체**(파이썬)를 Desktop이 직접 stdio로 실행. MCP는 202를 HTTP 호출만 하는 thin client라 **로직이 얇음** — "로직 전체를 PC에 깐다"는 아님. PC엔 Python + 작은 패키지 1회. **Node·브리지·HTTPS 불필요**, 설정도 `python -m w_robot_mcp` 한 줄. 업데이트는 패키지 재배포(또는 202에서 pull하는 런처로 자동화 가능).

> **중요(§12.8)**: MCP는 testbench의 thin HTTP client다 → **MCP가 어디서 돌든 기능은 동일**(202:8080에 닿기만 하면 됨). "중앙 vs 로컬"은 기능 문제가 아니라 **운영 문제**(업데이트 주체 / PC 런타임이 Python이냐 Node냐)일 뿐. Desktop이 로컬 프로세스만 띄울 수 있어 **PC에 무언가 1개는 불가피**.

→ **권장: 얇은 MCP라면 모델 A(로컬 stdio)가 더 단순**(Node·브리지·HTTPS 없음). 중앙 업데이트가 강하게 필요하면 모델 B. 어느 쪽도 **완전 무설치는 아님**(아래 12.7·12.8).

### 12.3 역할별 전제
| 역할 | 필요한 것 | 비고 |
|---|---|---|
| **일반 테스트 사용자** | Claude Desktop + 로봇 LAN + (모델 B면) 접속 설정 | Python·ROS·설치 **불필요** |
| **로드셀 담당(테스트 3·4)** | 로드셀 PC에 Phidget 네이티브 드라이버 + `loadcell_server.py` 실행 | Win=`Phidget22-x64.exe`/`start.bat`, Mac=`Phidgets.pkg`/`start.command`. 자동캡처 쓰려면 서버 `0.0.0.0` 노출 or MCP를 이 PC에서 |
| **관리자(202 운영)** | 기존 README 배포(ROS2 Jazzy+zenoh) + (모델 B면) MCP 상주 + 201 SSH 키 | 사용자와 분리 — 1회 셋업 |

### 12.4 Windows PC 특이사항
- **일반 사용자**: 모델 B면 Windows에 **추가 설치 없음**(Claude Desktop만). Windows 방화벽도 아웃바운드 접속이라 보통 무문제.
- **로컬 모델 A 선택 시**: Windows에 Python 설치·`pip install`·PATH 문제 등 비개발자 마찰 → 권장 안 함.
- **로드셀 담당이 Windows면**: Phidget 드라이버 설치 + Control Panel 닫기(장치 점유 충돌, README 명시). `start.bat`로 서버 기동.

### 12.5 사용자 PC에 **불필요**한 것 (오해 방지)
- ROS2·rclpy·zenoh (서버 202에만)
- 201 SSH 키 (202→201 서버 간만)
- 백엔드/프론트 소스, npm 빌드 (202에만)
- (모델 B면) Python·MCP 의존성

### 12.6 결정 필요
- 클라이언트: **Claude Desktop**(확정). 
- 배포 모델: **B 중앙 서버 + 얇은 브리지**(권장) vs A 로컬? → §7.3과 통합 결정.
- 모델 B 채택 시: MCP를 **Streamable HTTP** 서버로 구현(2026 표준; SSE는 신규 비권장).

### 12.7 "202 중앙"의 실체 + Claude Desktop 연결법 (검증됨)
**202가 뭔가**: 로봇의 **서버 PC1**(`192.168.34.202`). 이미 testbench 백엔드가 도는 **로봇 온보드 PC**. 중앙 MCP = 그 202에 **또 하나의 프로그램(파이썬)** 으로 얹는 것.

**어떤 형태로 "저장"되나**:
- **소스 코드 파일**로 202 디스크에 위치(예 `~/ros2_ws/src/w_robot_mcp/`), testbench 옆에. 클라우드·Claude 안이 아니라 **로봇 PC 안**.
- **프로세스로 상주** — testbench처럼 systemd 서비스로 등록해 부팅 시 자동 기동, LAN 포트(예 8765)로 listen.
- 생성물(테스트 plan·리포트·CSV)도 **202 디스크**에 저장(현재 snapshots/recordings와 동일 방식).

**Claude Desktop에서 쓰는 법 (1회 PC 설정)**:
1. PC에 **Node.js**(v18+) 설치.
2. `claude_desktop_config.json`에 아래 1블록 추가(IT가 푸시하거나 파일 배포):
```json
{ "mcpServers": {
    "w_robot": { "command": "npx", "args": ["mcp-remote", "http://192.168.34.202:8765"] }
} }
```
3. Claude Desktop **완전 종료 후 재시작** → 입력창에 MCP 도구 표시 → "옆문 열어"처럼 사용.

> 이후 도구·테스트가 늘어도 **202만 갱신**하면 됨(브리지는 그대로). 즉 PC 설정은 진짜 1회.

**대안 비교**:
| 경로 | PC에 필요 | 무설치? | 비고 |
|---|---|---|---|
| Desktop + mcp-remote 브리지(권장) | Node.js + config 1회 | △(1회) | LAN plain-http OK, 로직은 202 중앙 |
| claude.ai 웹 + 커스텀 커넥터 | 없음 | ○ | **HTTPS 필수 + 인터넷 노출** → 로봇 LAN 격리 깨짐, 비권장 |
| 완전 로컬(모델 A) | Python + 전체 로직 | ✗ | 관리부담 큼 |
| .mcpb 원클릭 번들 | Node 런타임 | △ | 배포는 쉬우나 여전히 로컬 본체 |

### 12.8 "PC에 정말 아무것도 안 깔기"(완전 무설치)의 실체와 비용
완전 무설치를 원하면 **Claude Desktop을 버리고 claude.ai 웹**을 써야 한다(웹은 브라우저만, 설치 0). 웹의 커스텀 커넥터로 원격 MCP를 붙이는 방식인데, 대가가 크다:

1. **HTTPS + 유효 인증서 강제** — `http://192.168.34.202`(LAN IP, plain http) 거부. 로봇 MCP에 도메인+TLS 필요.
2. **인터넷 도달성 필요** — claude.ai 원격 커넥터는 **Anthropic 클라우드(서버측)에서** MCP 서버를 호출한다. 즉 로봇의 MCP가 **인터넷에서 닿아야** 함 → 사설망(192.168.x)인 로봇을 Cloudflare Tunnel/VPN/ngrok 등으로 **외부 노출**해야 한다.
3. **⚠ 보안 — 결정적 문제**: 현재 testbench 백엔드는 **인증이 전혀 없다**(LAN 전제). 이를 인터넷에 노출하면 **누구나 로봇을 주행·E-stop·프로세스 kill** 할 수 있다. 무설치를 위해선 **MCP/백엔드에 인증 레이어(OAuth 등)부터 추가**해야 하고, 그래도 "조종 가능한 로봇을 인터넷에 노출"하는 리스크가 남는다.

→ **결론**: 완전 무설치는 *기술적으로 가능*하나, **로봇 제어면을 인터넷에 노출 + 인증 신규 구축**이라는 큰 비용·위험을 수반. 로봇 LAN 격리(현재 안전모델)를 깨므로 **권장하지 않음**. "PC당 런타임 1개(Python 또는 Node) 1회 설정"을 받아들이고 **LAN 안에서 도는** 모델 A/B가 현실적·안전.

---

## 13. 모델 A 확정 — 하드웨어팀 준비물 / 설치 / 배포 (TS + .mcpb)
**확정**: MCP를 **TypeScript/Node로 작성 → `.mcpb`(Claude Desktop 확장) 번들로 배포**. 근거: **Claude Desktop이 Node 런타임을 내장** → Node 기반 .mcpb는 **사용자 PC에 런타임·Node 설치 없이 더블클릭 원클릭 설치**, `manifest.json`의 `user_config`로 백엔드 URL을 **UI 폼 입력**(JSON 편집 없음). (Python .mcpb는 Python 미번들 → 사용자가 Python 설치 필요 → 비채택.)

### 13.1 Q1 — 아무것도 모르는 HW팀이 준비할 것 (사용자 PC)
원클릭 .mcpb 기준, **딱 4가지**:
1. **Claude Desktop 설치** (Win/Mac). — 일반 앱 설치, 비개발자 가능.
2. **로봇 Wi-Fi/LAN 접속** — PC가 `192.168.34.x`에서 202에 닿아야 함(웹툴과 동일 조건).
3. **로봇이 켜져 있을 것** — 누군가 testbench(202)를 기동(또는 systemd 자동). 안 켜져 있으면 토픽 없음(§3) → preflight가 안내.
4. **배포받은 `w_robot.mcpb` 더블클릭** → 설치 시 백엔드 URL(`http://192.168.34.202:8080`)을 폼에 입력(기본값 채워둠) → 끝.

> **불필요**: Python, Node, 명령어, `claude_desktop_config.json` 편집, ROS, 소스코드, SSH. (로드셀 담당만 별도로 로드셀 PC에 Phidget 드라이버+서버 — §12.3.)

### 13.2 Q2 — Claude Desktop에 "설치해줘" 하면 자동으로 되나?
- **첫 설치(부트스트랩)는 채팅으로 자동화 불가.** 갓 설치한 Claude Desktop은 **시스템 명령·파일 접근 도구가 없다**(MCP가 아직 안 붙어서). "설치해줘"라고 해도 실행할 수단이 없음 — 닭-달걀.
- **대신 `.mcpb` 더블클릭이 사실상 자동 설치다.** Desktop이 압축 해제·등록·재시작·설정 폼을 자동 처리 → 비개발자가 할 일은 더블클릭 + URL 확인뿐. "채팅으로 시키는 자동"이 아니라 **"원클릭 번들"이 곧 자동화**.
- 설치 *이후*에는 Claude가 MCP 도구로 로봇을 조작·안내 가능(그게 본 목적). 단 MCP가 자기 자신을 깔거나 PC에 다른 SW를 설치하진 못함(그럴 권한 도구 없음, 의도적).
- (참고) Claude **Code**(CLI)는 셸·파일 도구가 있어 설치까지 대신 가능하나, 비개발자용이 아니라 채택 안 함.

**"더블클릭하면 Claude가 알아서 읽나?" — 정확한 동작**:
- 더블클릭 = 즉시 채팅 활성화가 아니라 **설치 대화상자**가 한 번 뜸 → 권한 확인 + 백엔드 URL 폼 확인 → 설치 → (보통) 재시작. 이후 **모든 새 대화에 도구가 자동 노출**(다시 불러올 필요 없음).
- Claude는 문서를 "읽는" 게 아니라, MCP가 노출한 **도구 목록 + 설명 + 서버 instructions**만 본다. 폴더·설계문서·manifest는 **읽지 않음**.
- 실제 로봇 상태는 **도구를 호출할 때만** 조회(예 "옆문 열어" → `open_door` 호출 시 202에 HTTP).
- ⚠ 따라서 Claude가 "알아서 똑똑하게" 구는 정도 = **MCP에 우리가 넣은 도구 설명·`instructions`(§11.5)·테스트 카탈로그의 함수**. 이걸 안 넣으면 옆문 테스트·안전규칙을 **모름**. 즉 §9·§11 설계물이 곧 "Claude가 알아서 하게 만드는 내용물"이다.

### 13.3 Q3 — 내 PC의 `HWtest` 폴더째로 넘기면 더 쉬워지나?
**아니오 — 일반 사용자에겐 오히려 혼란.** 이유:
- 폴더엔 **백엔드(testbench)·로드셀**도 들어있는데, 이건 **202/로드셀 PC에서만** 도는 것. 일반 사용자 PC는 **백엔드 불필요** — 폴더째 주면 "내가 이걸 다 돌려야 하나?" 오해.
- 당신 PC는 **macOS**, HW팀은 주로 **Windows** → 설치된 Python venv·바이너리는 **OS 종속이라 그대로 안 옮겨감**. 폴더 복사로 실행환경이 따라오지 않음.
- 폴더엔 런타임이 없음 → 복사만으로 실행 가능해지지 않음.

**폴더가 유용한 곳은 따로 있다**:
- **202 관리자**: 폴더(=레포)로 백엔드 + MCP를 202에 배포(기존 README 흐름).
- **빌드 소스**: 이 레포에서 `.mcpb`를 **한 번 빌드**해 그 결과물(작은 `.mcpb` 1개)만 팀에 배포. ← 사용자에게 줄 단위는 **폴더가 아니라 .mcpb**.

### 13.4 배포 플로우 (관리자/빌더 1회)
```
[빌더 1회]  레포에서 TS MCP 작성 → npx @anthropic-ai/mcpb init → mcpb pack → w_robot.mcpb
[배포]      w_robot.mcpb 파일을 팀에 공유(사내 드라이브/메신저)
[사용자]    더블클릭 → URL 폼 확인 → 사용. 업데이트는 새 .mcpb 더블클릭으로 교체.
```
- ⚠ `.mcpb`는 **서명 없음 + 비샌드박스 실행**(전체 권한). 사내 신뢰 배포는 무방하나 **신뢰된 경로로만 전달**(임의 네트워크 전송 지양). 공개 확장과 무관.

### 13.5 이 결정이 바꾸는 것
- 구현 언어: 이전 문서의 "파이썬 thin client" → **TypeScript**로 변경(기능 동일, 배포가 결정적으로 쉬움). 백엔드/로드셀은 그대로 Python.
- §6 단계: 1단계 산출물에 **`.mcpb` 패키징 + user_config(백엔드 URL)** 포함.

---

## 14. 구현 계획
스택: **TypeScript + `@modelcontextprotocol/sdk`(stdio) + `ws`**, 산출물 `w_robot.mcpb`. 백엔드 **무수정**. 위치 `tools/w_robot_mcp/`(레포 내 신규 폴더, 빌드 소스).

### 14.1 마일스톤
| 단계 | 산출물 | 내용 | 검증 |
|---|---|---|---|
| **M0 스캐폴드 ✅** | `tools/w_robot_mcp/` (TS) + `w_robot_mcp.mcpb` | manifest+`user_config`(backend/loadcell URL), HTTP 클라이언트, `health`/`get_system_status`, 페르소나 instructions, 사람말 오류 | ✅ tsc 빌드·stdio 프로토콜(initialize/list/call)·오류 폴백·.mcpb pack(8MB) 검증. **실백엔드 연결만 미검증(로봇 부재)** |
| **M1 관측+발견 ✅** | 읽기 도구군 | ✅ `get_system_status`·`get_diagnostics`·`get_motor_status`·`list_controllers`·`list_topics`·`describe_command`·`get_capabilities`·`list_launches` 구현·실로봇 검증. 잔여(소): `whats_new`/`list_expected_interfaces`/`what_to_launch` | ✅ swerve active·cmd_vel·diag18개·런치149개 확인. 모터 상세값은 비에너자이즈라 레벨만(실측 정합) |
| **M2 WS 구독+링버퍼 ✅** | 실시간 | ✅ `/ws` 상시연결·백오프 재연결, 기본 sub(joint_states/odom/imu), 링버퍼 30s, `get_latest`·`get_recent`·`watch`·`list_watched`·`subscribe_topic`·`unsubscribe_topic`. JointState 인지형 평탄화(조인트별 통계) | ✅ 실로봇 joint_states ~15Hz 적재, `watch`가 조향4/구동2/conveyor/door_S1 effort·vel·pos 통계 산출 |
| **M3 제어+안전 ✅** | 제어 도구군 | ✅ `drive`(하트비트+**항상 confirm**+계획)·`stop`·`emergency_stop`(래치)·`reset_estop`·`estop_status`·`cancel_navigation`·`switch_controller`(confirm)·`send_nav_goal`(confirm)·`run_launch`/`stop_launch`·`profile_up`/`down`·`preflight` + **GUI stop.html** + 파괴적(kill)은 `MCP_ALLOW_DESTRUCTIVE` 게이트 | ✅ 빌드·계획모드(무이동)·래치·confirm 차단 검증. **실주행은 사용자 승인 하 미실시** |
| **M4 테스트 레이어 ✅** | 데이터 레이어 + 리포트 | ✅ **아키텍처 정정**: 초안/리뷰/오케스트레이션은 Claude(LLM), MCP는 데이터·리포트. `save/list/get_test_plan`·`start_test_run`·`record_observation`·`record_measurement`·`finish_test_run`(MD+JSON+CSV)·`open_test_report` + `review_checklist`·`test_plan_template`. 스텝 3종은 Claude가 원자 도구로 실행하며 기록. | ✅ E2E: 계획저장→런시작(view-compose 추천)→측정/관측 기록→리포트 생성 검증 |
| **M5 도어/로드셀+배포** | 실전 채비 | `config/subsystems/door.yaml` 작성(제어 `/door_s1_controller/command`, 텔레 `joint_states[door_s1]`; 솔레노이드/스위치 라이브발견), 로드셀 `GET /api/reading` 자동캡처(폴백 수기), 최종 `.mcpb` + 1장 퀵스타트 | 실로봇에서 옆문 테스트 1회 완주 |

### 14.2 순서/의존
- M0→M1→M2→M3 순차(각자 독립 검증). M4는 M3까지 위에 얹음. M5는 실로봇/실로드셀 필요 → 환경 준비되면.
- M0~M4는 **dev 백엔드만으로** 개발·검증 가능(로봇 없이). 실로봇은 M5와 최종 점검에서.

### 14.3 착수 전 확정 필요(차단 항목)
- **§7**: 속도 상한 기본값(M3), 파괴적 동작(시작플랜/kill) 포함 여부(M3), 링버퍼 길이/레이트(M2).
- **§10**: 실행 기본 모드 guide/auto(M4), 로드셀 바인딩 해법(M5), 무인 반복 1단계 한계(M4), 리포트 형식(M4).
- 그 외(언어 TS·배포 .mcpb·모델 A)는 확정됨.

### 14.4 리스크
- 도어/솔레노이드/스위치 토픽 **미실측** → M5에서 라이브 발견으로 확정(플레이스홀더 금지).
- 로드셀 `127.0.0.1` 바인딩 → 자동캡처 시 §10-6 해결 선행.
- `.mcpb` 비서명·비샌드박스 → 신뢰 경로 배포 정책(§13.4).

---

## 15. 정지 우선권 / 안전 인터록 (최우선 설계)
요구: **어떤 단계에서도 "정지"가 모든 것에 우선**해야 한다. 도구 하나가 아니라 **구조(인터록)** 로 만든다.

### 15.1 핵심 함정 — "Claude 정지" ≠ "로봇 정지"
- Claude Desktop의 **정지 버튼**은 *Claude의 턴*만 중단한다. **이미 백엔드로 간 명령(주행 cmd_vel, 진행 중 nav goal, 떠 있는 컨트롤러/런치)은 계속 돈다.**
- 또한 Claude가 긴 작업을 **한 번의 블로킹 호출**로 실행 중이면, 사용자가 친 "정지" 메시지는 턴이 끝날 때까지 처리되지 않을 수 있다.
- 결론: 정지는 *Claude를 멈추는 것*이 아니라 **로봇에 실제 정지를 도달**시켜야 하고, 대화 흐름에 의존하면 안 된다.

### 15.2 3중 구조 (이걸 "만들어 둠")
> **✅ 확정(개발자 확인)**: 스워브 컨트롤러에 **`cmd_vel_timeout` = 0.5s 구현됨** — 마지막 cmd_vel로부터 0.5초 내 다음 명령이 없으면 컨트롤러가 자동 정지. 별도 비상정지 장치는 없으나, **이 타임아웃이 진짜 페일세이프 역할**을 한다.

**① 데드맨 — "명령 없음 = 정지" (✅ 컨트롤러 0.5s 타임아웃으로 성립)**
- 컨트롤러가 **마지막 명령 후 0.5s면 자동 정지** → 정지버튼·Claude중단·네트워크 단절·**MCP 사망** 어느 경우든 명령 공급이 끊기면 **≤0.5s 내 자동으로 멈춘다.** 정지가 "도달"하지 않아도 안전.
- **그래서 `drive`는 하트비트 방식**: duration 동안 cmd_vel를 **0.5s보다 빠르게 반복 발행**(예 5–10Hz)하고, duration 끝나면 **발행 중단**(+명시적 0 1회) → 타임아웃이 마무리. 단발 publish는 ≤0.5s만 움직이고 자동 정지.
- **무방비 구간 = 최대 0.5s.** 이는 안전거리 산정의 상수(§15.9-안전거리).
- 무한·장시간 모션 도구를 만들지 않는다(설계 금지 규칙). 하트비트가 끊기면 자동 정지가 곧 안전장치.

**② 정지 래치(인터록) — engaged 되면 모든 제어 거부**
- `emergency_stop` 호출 시: `POST /api/emergency/stop`(cmd_vel 0 + 컨트롤러 비활성 + nav 취소) **실행 + "정지 상태(engaged)" 래치 설정**.
- 래치가 engaged인 동안 **모든 제어 도구**(drive/door/switch_controller/nav/launch/run_test 스텝)는 **즉시 거부**: "비상정지 상태입니다. '정지 해제'라고 말해야 다시 움직입니다."
- **자동 해제 금지** — 물리 E-stop처럼 **명시적 `reset_estop`("정지 해제")** 으로만 풀린다. (deactivate된 컨트롤러 재활성은 confirm.)
- 위치: **최소** MCP 레벨 래치(백엔드 무수정, MCP 경로만 보호) / **권장** 백엔드 레벨 래치(작은 백엔드 추가: estop 플래그 + publish/service/action/controllers 엔드포인트가 플래그 확인 후 거부 → **웹 UI·다른 클라이언트·다른 사용자까지 전부 차단**). 안전은 백엔드 래치가 정답.

**②-보강 drive 좀비발행 차단(구현됨)**: GUI 정지(stop.html)는 백엔드로 직접 가 컨트롤러를 비활성화하므로 MCP의 `drive` 루프는 이를 모른 채 남은 시간 cmd_vel를 계속 발행할 수 있다(꺼진 컨트롤러가 무시→무해하나, 그 사이 컨트롤러 재활성 시 "덜컥" 위험). → `drive`가 **0.5s마다 swerve_controller active 여부를 재확인**하고 비활성 감지 시 **즉시 발행 중단**. 시작 전 active 사전점검도 수행. 이로써 좀비발행이 어떤 주행 길이든 ≤0.5s로 제거됨(MAX_DURATION 30s 허용 가능해짐).

**②-연속주행 비블로킹(구현됨)**: 긴/연속 주행은 블로킹 `drive` 대신 **`start_drive`(백그라운드 하트비트, 즉시 반환) + `stop`**. Claude가 안 묶이고 주행 중 `watch`로 모니터 가능. 백그라운드 루프가 0.5s마다 컨트롤러 active 확인·정지래치·백스톱 타임아웃(기본 180s) 중 하나라도 걸리면 자동정지. `stop`/`emergency_stop`이 이 드라이버도 함께 중단. → drive의 30s 캡은 "블로킹 호출 길이 제한"일 뿐 안전 한계가 아님(연속은 start_drive로).

**③ 논블로킹 + 스텝마다 래치 확인 — 정지가 항상 즉시 먹히게**
- 긴 시퀀스(`run_test` auto, 반복 사이클, `watch`)는 **한 방 블로킹 호출 금지**. 스텝 단위로 쪼개거나 백엔드/백그라운드에서 돌리고 Claude는 빠르게 반환 → 대화가 항상 "정지" 메시지를 받을 수 있게.
- `run_test`는 **매 스텝 직전 래치 확인** → engaged면 즉시 중단. (수동 스텝 대기 중에도 정지 가능.)
- `emergency_stop`은 confirm 없이 **항상 노출·즉시 실행**(유일하게 무조건 통과하는 명령).

### 15.3 사용자가 정지를 거는 경로(우선순위)
1. **물리 하드웨어 E-stop 버튼 — 최종 권위(아래 15.4).**
2. **🛑 GUI 정지 페이지(`tools/w_robot_mcp/stop.html`)** — 브라우저에 띄워놓는 큰 STOP 버튼. 클릭/`Space`/`Esc` → **Claude·MCP와 무관하게** 백엔드 `/api/emergency/stop`로 직접 전송(no-cors, 본문없는 단순 POST → CORS 무관, 3회 발행). 대화 흐름에 의존하지 않는 독립 정지 경로 = §15.1 함정 해소. **구동 테스트 시 항상 열어둔다.**
3. **"정지/멈춰/stop" 발화** → Claude가 `emergency_stop`/`stop` 호출(②).
4. **클라이언트 정지 버튼** → 턴 중단 → 모션은 데드맨(0.5s)으로 자멸(①). 단 nav/컨트롤러까지 끄려면 ② 필요.

### 15.4 ⚠ 솔직한 한계 — 소프트웨어 정지는 보조다
- 모든 SW 정지(cmd_vel 0·컨트롤러 비활성)는 **네트워크·백엔드·MCP·zenoh가 살아 있어야 도달**한다. 그게 끊기는 순간이 바로 정지가 필요한 순간일 수 있다.
- **🔴 이 로봇에 물리 E-stop이 없다면 = 실제 안전 공백.** 특히 하중 주행·도어 가압 테스트에서 치명적. 이상적으로는 **물리 E-stop(또는 즉시 전원차단 수단)이 최종 권위**여야 하나, 부재 시 그 역할이 비어 있다 → §15.8 must-verify.
- 부재가 확인되면: ①(컨트롤러 timeout 기반 데드맨)을 **반드시 활성화**해 공백을 최대한 메우고, `review_test_plan`이 모든 주행/가압 테스트에서 **물리 정지수단 부재를 최우선 경고**로 띄운다(수동 전원/배터리 차단 담당·위치 절차화).

### 15.8 must-verify (201 컨트롤러 팀)
1. ~~cmd_vel 타임아웃 유무~~ → **✅ 확정: 0.5s 구현됨.** (명령 끊김 시 ≤0.5s 자동 정지)
2. **swerve_controller 비활성 시 바퀴 거동** — 브레이크/홀드 vs 프리휠(공회전)? 경사 프리휠이면 비활성이 미끄럼 유발 → estop의 컨트롤러 비활성 사용 여부 판단. (남은 확인)
3. **물리 E-stop/즉시 전원차단 수단이 있나?** — 0.5s 타임아웃으로 "명령 상실" 위험은 덮였으나, 컨트롤러 오작동·기타 액추에이터엔 물리 수단이 여전히 강한 2차 안전. (남은 확인, 우선순위 ↓)
4. **cmd_vel 0의 실제 정지 거동**(관성 잔존 거리) — 안전거리 산정용. (남은 확인)

### 15.9 ✅ 정지 모델 확정 (0.5s 타임아웃 기반)
- **페일세이프 = 컨트롤러 0.5s 타임아웃.** Claude 중단·MCP 사망·네트워크 단절 등 **명령 공급이 끊기는 모든 경우 ≤0.5s 자동 정지.** SW로 못 막던 "주행 중 사망" 위험이 **해소됨.**
- **`drive` 구현 = 하트비트**: duration 동안 cmd_vel 5–10Hz 반복 → 끝나면 발행 중단(+0 1회). 멈추려면 "그냥 안 보내면" 됨.
- **`emergency_stop`은 여전히 필요**: nav 액션이 **능동적으로 cmd_vel를 계속 발행 중**이면 타임아웃이 안 걸린다 → estop이 **nav goal 취소**(+0 발행 + 컨트롤러 비활성)로 그 소스를 끊어야 함. 즉 "발행 주체가 있는" 정지엔 estop, "발행이 끊긴" 정지엔 타임아웃.
- **MCP 측**: `stop`/`emergency_stop`은 0 버스트 발행 + nav 취소 + 래치(이후 비제로 차단). 컨트롤러 비활성은 #2 거동 확인 후 채택.
- **안전거리 상수**: 최악 무방비 = 0.5s. **속도 하드캡이 없으므로(§4-1 소프트캡)** 잔존 거리는 *실제 명령 속도*로 계산해야 함 — 0.3 m/s면 ≈0.15m+관성, 더 빠르면 비례 증가. 고속(≥0.3) 주행은 confirm을 거치므로 그때 안전거리를 함께 환기. 가압·근접 테스트 안전거리에 반영, `review_test_plan` 점검.

### 15.5 구현 반영
- **M3에 ②③ 포함**(래치·스텝확인·논블로킹), ①데드맨은 M3 `drive`에 이미. **1차는 MCP 래치 → 백엔드 무수정**(§15.7). 백엔드 래치는 향후 선택지일 뿐.
- 도구 추가: `reset_estop`(명시 해제), `estop_status`(현재 래치 상태 조회 — preflight·대시보드에 표시).
- 명확화: **백엔드 래치 = 개발자가 빌드 시 코드 1회 추가**(estop 플래그 + 엔드포인트 확인). 사용자는 평소처럼 "정지"라고 말할 뿐, **터미널 조작 아님.** MCP 래치와 사용자 경험 동일, 차이는 "어느 프로그램이 잠그느냐"뿐.

### 15.6 ⚠ 백엔드 래치 추가 시 우려 + 완화 (채택 전 검토)
| # | 우려 | 완화 |
|---|---|---|
| 1 | **estop/reset이 게이트에 막히는 자기모순** — estop은 내부적으로 publish+switch_controller를 쓰는데 게이트가 이를 거부하면 "정지를 못 거는 정지" | estop/reset 경로를 **게이트 면제**로 명시 분리. 게이트는 *사용자 명령* 경로에만 |
| 2 | **재시작 시 래치 소실/혼란** — 인메모리면 백엔드 재기동 후 풀림 / 영속이면 재부팅 후 잠긴 채 시작 | **페일세이프 = 영속 + 명시 해제** 권장. 기본 동작 문서화. 시작 시 estop_status로 명확 표시 |
| 3 | **커버리지 누락 = 구멍** — publish·service·action·controllers·launch·profiles·admin 중 하나라도 빠지면 그 입구로 동작 | "정지 중 차단 대상" 목록을 **단일 지점**(미들웨어/공통 가드)에서 강제. 읽기 허용·액추에이션 차단 정책 명문화 |
| 4 | **래치≠실제정지** — 컨트롤러/CM 503이면 비활성 실패 → 플래그는 켜졌는데 로봇은 안 멈춤 | 래치는 *새 명령 차단 + estop 시도*까지. 실제 정지 보장은 ①데드맨 + **물리 E-stop**(§15.4). estop 결과를 사용자에 정직히 보고 |
| 5 | **핫패스 회귀 — 전원 영향** — 게이트가 모든 명령 길목 → 버그 시 과차단(먹통)/과소차단(미정지), 웹 UI 사용자까지 | 가드를 얇게·단일 함수로. **회귀 테스트 필수**(차단/면제/해제 케이스). 단계적 롤아웃 |
| 6 | **웹 UI가 래치를 모르면 UX 혼란** — 버튼이 조용히 거부됨 | estop 이벤트에 **latched 플래그 broadcast** + 프론트에 "정지 상태 배너 + 해제 버튼" 추가(추가 범위) |
| 7 | **무인증 → 누구나 해제** — LAN 아무나(실수로도) reset 가능 | 현 보안모델(신뢰 LAN) 한계 명시. 필요 시 reset에 한해 간단 확인/PIN 검토(별도) |
| 8 | **MCP↔백엔드 버전 스큐** — 202 미업데이트면 MCP는 보호받는 줄 알지만 게이트 없음 | MCP가 `estop_status` 유무로 **백엔드 래치 능력 탐지** → 없으면 **MCP 래치 폴백 + 경고** |

> **종합 판단**: 백엔드 래치가 안전상 우월(전 경로 차단)하나, #1·#5·#6 때문에 **공용 핫패스를 건드리는 실질 작업**이 된다(프론트 포함). 권장 경로: **(a) MCP 래치 + 데드맨 + 물리버튼으로 1차 출시 → (b) 백엔드 래치를 별도 안전 작업으로 신중 추가**. 단, 테스트 중 **웹 UI/타 사용자 동시조작 가능성**이 실재하면 처음부터 백엔드 래치를 우선.

### 15.7 ✅ 확정 — 단일 조작자 전제 → 1차는 MCP 래치
**운영 전제 확정: 테스트 시 한 번에 한 사람(MCP)만 조작.** 동시 조작 경로가 없으므로:
- **1차 출시 = MCP 래치 + 데드맨(①) + 물리 E-stop. 백엔드 무수정.** (백엔드 래치는 보류; 추후 필요 시 §15.6 따라 추가)
- ⚠ 이 전제는 **절차적 약속**이지 기술적 강제가 아니다(백엔드 무인증 + 웹 UI 상존). **테스트 중 웹 UI를 열지 않는다**를 절차서·교육에 명시(=`review_test_plan` 점검 항목).
- 보조 안전망: MCP `preflight`가 가능하면 **다른 활성 클라이언트/외부 명령 흔적**(예 WS 연결 수, 예기치 않은 cmd_vel)을 감지해 "다른 조작자가 있는 것 같아요" 경고. 완전 탐지는 불가하나 사고 위험 1차 차단.
- 전제가 깨지는 순간(다중 조작자 상시화)이 오면 **백엔드 래치로 승격**(§15.6) — 이때 결정 트리거로 기록.
