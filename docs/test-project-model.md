# 테스트 프로젝트 — 데이터 모델 & 실행 라이프사이클 (부속 D)

> testbench의 **중심 1급 객체**인 "테스트 프로젝트(Test Project)"의 스키마와 실행 상태머신 설계.
> 사용자가 GUI로 **런타임에 저작**하는 단위로, 기존 `profile`·`subsystem`·`test` 3종(DESIGN §4.3)을 **하나로 통합**한다.
> 개발자가 미리 만든 하드웨어팀 52테스트(부속 B)는 이 모델의 **프리셋 템플릿**으로 흡수된다.
> 본 문서가 확정되면 DESIGN §4(아키텍처)·§6(스키마)·§8(UX)을 이 축으로 재구성한다.

---

## 0. 한 줄 요약

> **테스트 프로젝트 = (레이아웃·위젯) + (필요 런치/노드) + (위젯에서 파생된 의존 리소스).**
> 실행하면 ① 원하는 프로세스 상태로 **수렴(reconcile)**하고 ② 의존 리소스를 **사전점검(preflight)**한 뒤 ③ 저작한 레이아웃대로 **라이브 렌더**한다. 종료 시 이 실행이 켠 것만 **정리**한다.

---

## 1. 용어

| 용어 | 정의 |
|---|---|
| **테스트 프로젝트(Project)** | 사용자가 저작·저장하는 1급 객체. 본 문서의 주제. |
| **빌트인 프로젝트(Builtin)** | `origin: builtin`인 읽기전용 기준 프로젝트. 복제해 시작점으로 씀. **간단한 사용법 튜토리얼 1~2개**만 제공(52테스트를 미리 구현하지 않음 — 부속 B는 참고자료). 별도 "프리셋" 엔티티는 두지 않음(§6). |
| **위젯(Widget)** | 레이아웃을 구성하는 단위 패널. 제어/플롯/상태/영상 등. |
| **의존 리소스(Required Resource)** | 위젯·프로세스가 동작하려면 라이브에 존재해야 할 topic/service/action. 대부분 위젯에서 **자동 파생**, 일부 수동 보강. |
| **필요 프로세스(Required Process)** | 이 프로젝트가 켜야 할 런치/노드 (= 기존 `profile`). |
| **베이스라인(Baseline)** | 항상 떠 있어야 하는 persistent 집합. **동적**(201 유무·테스트 범위에 좌우) — **빈 집합 허용**, 런타임 수정 가능(§2.5). 수렴 시 절대 종료 대상 아님. |
| **수렴(Reconcile)** | 현재 라이브 프로세스를 *원하는 집합(baseline ∪ required)* 에 맞추는 동작. |
| **사전점검(Preflight)** | 필요 프로세스 기동 후, 의존 리소스가 실제로 라이브에 존재(+발행)하는지 검증. |
| **출처(Provenance)** | 각 라이브 프로세스가 누구 소유인지 태그(baseline / project / ad-hoc / foreign). **정리의 근거.** |

---

## 2. 데이터 모델

프로젝트는 JSON으로 저장(`config/projects/<id>.json`), 프리셋은 git-tracked YAML(`config/presets/*.yaml`)로 배포. 동일 스키마.

```yaml
test_project:
  id: proj_01                       # 안정 식별자(slug)
  name: "테스트 프로젝트 1"          # 사용자 표시명
  description: ""
  origin: user                      # user | builtin (builtin=읽기전용 기준 프로젝트, git-tracked)
  cloned_from: null                 # 복제 시 원본 프로젝트 id
  created_at / updated_at: <iso>

  # ── (A) 레이아웃 + 위젯 ───────────────────────────────
  layout:
    grid: { cols: 12, row_h: 40 }   # 반응형 그리드(데스크톱 상주 전제)
    widgets: [ <Widget>, ... ]      # §3

  # ── (B) 필요 프로세스 (= 기존 profile) ────────────────
  processes:                        # 이 프로젝트가 책임지고 켜는 것
    - id: teleop_joy
      machine: server               # server(202) | controller(201, SSH)
      kind: launch                  # launch | node | run
      command: "ros2 launch w_robot_teleoperation teleop_joy.launch.py"
      depends_on: []
      healthcheck: { type: topic, topic: /joy, timeout_s: 10 }

  # ── (C) 의존 리소스 (위젯에서 파생 + 수동 보강) ────────
  resources:
    derived: true                   # 위젯에서 자동 추출(기본)
    require:                        # 수동 보강/override
      - { kind: topic,   name: /diagnostics, type: diagnostic_msgs/DiagnosticArray, expect_rate_hz: 1 }
      - { kind: service, name: /controller_manager/switch_controller }
      - { kind: action,  name: /swerve_controller/follow_path }

  # ── (D) 실행 정책 ─────────────────────────────────────
  policy:
    exclusive: true                 # 한 번에 이 프로젝트만 active(잔여 종료 동의 대상)
    on_orphan: ask                  # ask(기본) | keep | kill — 잔여 프로세스 처리
    cleanup_adhoc_on_stop: true     # 점검 중 임시로 켠 것 종료 시 정리

  # ── (E) 실행 러너 (선택, 기존 test.cycle 흡수 / 역량 E) ─
  runner:                           # 생략 시 manual = 수동 관찰·조작 프로젝트
    mode: manual                    # manual | cycle(반복 내구성) | sequence(단계 절차)
    cycle:                          # mode=cycle 일 때
      steps:                        # 한 사이클의 동작 — control.* 위젯을 id로 참조
        - { call: w_rear_open,  settle_s: 1.5 }
        - { call: w_rear_close, settle_s: 1.5 }
      count: 1000                   # 반복 횟수
      stop_on: { sensor: /bumper/triggered, equals: true }  # 안전 중단 조건
    counters: [cycle_count, hall_zero_events]   # → record(L6)

  # ── (F) 자산화 (선택, 기존 test.record 흡수) ──────────
  record:
    topics: [/diagnostics]
    export: [csv]
    counters: [cycle_count]
    verdict: manual               # 합/불은 테스터 수동 입력 — 자동 판정식 없음(§6-7)
```

> `processes`가 곧 기존 `profile`이고, `record`가 기존 `test`의 기록부다. 즉 **프로젝트 하나가 profile+subsystem-controls+test를 모두 품는다.**

---

## 2.5 서버 부팅 라이프사이클 (Clean-Slate 게이트)

testbench 서버는 **이 서버가 모든 ROS 프로세스의 유일한 기동 게이트웨이**라는 전제 위에 선다. 이 전제가 §5(소유권)·§4(수렴)를 결정적으로 단순화하므로, 부팅 자체를 게이트한다.

```
서버 시작
  ▼
[A] PREBOOT_SCAN : 이미 떠 있는 ROS2 관련 프로세스 탐지(§2.6)
  ▼
관리되지 않는 ROS 프로세스 있음?
  ├─ no ──────────────────────────▶ [C] READY
  └─ yes
      ▼
   [B] BLOCK : 팝업 "관리되지 않는 ROS 프로세스 N개 감지"
        ├ "취소" → 서버 기동 거부 (잔존이 살아있는 한 계속 차단)
        └ "종료" → 잔존 프로세스 정리 → [C]
  ▼
[C] READY : 이후 뜨는 모든 ROS 프로세스 = testbench 소유(레지스트리 추적)
            baseline 미설정 시 초기 세팅 마법사 유도(§2.5.1)
```

> 의미: [C] 이후 **외부에서 난입하지 않는 한** 모든 ROS 프로세스의 출처가 확실해진다 → `foreign` 판별이 휴리스틱 추정에서 **레지스트리 차집합**으로 바뀐다(§5).
>
> **2026-06-09 실증**: 실로봇에서 "기존 ROS 전부 종료(202·201=0) → baseline(zenoh→robot→control) 순차 기동+healthcheck"가 그대로 작동 확인(`docs/verification-2026-06-09.md`).

### 2.5.1 baseline 동적 세팅
- baseline은 **고정이 아니다.** 201 컨트롤러 유무·테스트 범위에 따라 달라진다.
- 부팅 후 baseline이 비어 있으면 **초기 세팅 마법사**로 구성을 유도(zenoh/robot_urdf/controller 중 무엇을 persistent로 둘지, 201 SSH 사용 여부).
- **세팅을 건너뛰면 baseline = 빈 집합**으로 인지한다(202 단독 테스트 허용).
- 이후 **관리자 페이지**에서 baseline을 언제든 수정. 변경은 수렴 정책에 즉시 반영(실행 중 프로젝트가 있으면 경고).

### 2.6 ROS 프로세스 식별 기준
"관리 대상 ROS 프로세스"는 아래로 판별한다. **게이트(부팅 1회) + 런타임 난입 감시(주기)** 두 곳에서만 사용한다.
- **cmdline 패턴**: `rmw_zenohd`, `ros2 run|launch`, `_ros2_daemon`, `/opt/ros/<distro>/`, 그리고 launch가 띄운 자식(python 노드 등 — 프로세스 트리로 추적)
- **그래프 조회**: `ros2 node list` / daemon 응답으로 살아있는 노드 교차확인
- 평상시 소유권은 **기동 레지스트리(owned PIDs)** 가 책임지므로, 이 휴리스틱은 *게이트와 외부 난입 감지*에만 쓰여 오탐 부담이 작다.

---

## 3. 위젯 카탈로그 & 의존 리소스 파생

위젯은 `kind`로 구분되는 discriminated union. **각 위젯은 자신이 의존하는 리소스를 스스로 신고**하고, 이를 모두 합쳐 프로젝트의 `resources.derived` 집합이 만들어진다(이게 preflight의 입력).

| 분류 | kind | 핵심 필드 | 파생 의존 리소스 |
|---|---|---|---|
| **제어** | `control.topic_pub` | `name`, `type`, `form`(zod 필드) | publisher 대상 topic (존재 불요, 단 type 확인) |
| | `control.service` | `name`, `type`, `form` | **service** 존재 필수 |
| | `control.action` | `name`, `type`, `goal_form` | **action** 서버 존재 필수 |
| **플롯** | `plot.topic` | `topic`, `fields[]`, `downsample` | **topic** 존재 + (옵션)`expect_rate_hz` |
| | `plot.system` | `metric`(cpu·mem·temp·net), `machine` | 프로세스 무관 — monitor(L0)가 공급 |
| **상태** | `state` | `topic`/`field`, 표시규칙 | topic 존재 |
| | `diagnostics` | `hardware_id` 필터 | `/diagnostics` 존재 |
| **영상** | `image` | `topic`/stream, `hub_port` | 카메라 스트림(별도 파이프라인, 부속 B 역량 H) |
| **버튼** | `action.estop` | — | 전역 E-stop(항상 가용) |

**파생 규칙(핵심)**:
- 발행(publisher) 위젯 → 대상 topic이 *없어도 됨*(내가 만들 것). 단 메시지 **type 해석** 필요.
- 구독/호출(plot·state·service·action) 위젯 → 대상 리소스가 **반드시 라이브에 존재**해야 함 → preflight 대상.
- `plot.system`은 ROS 그래프와 무관(psutil/sensors) → preflight에서 제외, monitor 가용성만 확인.

> 예) 모터 온도/전류/토크 플롯은 현재 로봇이 `/diagnostics`(hardware_id `can2:<id>`)로 publish → `plot.topic`이 아니라 `diagnostics` 위젯으로 `/diagnostics` 1개를 의존. (실측 근거; 인터페이스 변동 시 §7로 재확인)

### 3.1 위젯 공통 스키마
모든 위젯이 공유하는 골격(나머지는 `kind`별 고유 필드):
```yaml
- id: w_rear_open                   # 위젯 고유 id (runner.steps가 참조)
  kind: control.service             # discriminated union 판별자
  title: "뒷문 열기"
  pos: { x: 0, y: 0, w: 3, h: 2 }   # 12-col 그리드 좌표·크기
  # ↓ kind별 고유 필드 (§3 표)
```

### 3.2 명령 위젯의 동적 폼 생성 (pub / service / action)
사용자가 토픽·서비스·액션 **이름만 고르면 폼이 자동 생성**된다 — 이게 "친화적 publish/service/action"의 핵심. 흐름:

1. 저작 시 `name` 선택 → 백엔드가 **메시지/서비스/액션 타입을 introspect**(`/api/topics/{n}/type` 등, 부속 A introspect)
2. 타입 정의(.msg/.srv/.action 필드)를 **필드 트리**로 파싱(중첩 메시지 재귀)
3. 필드 트리 → **zod 스키마 + 기본값** 생성 → 프론트 react-hook-form 렌더(ParamForm 계승)
4. 제출 시 폼값 → 메시지 dict 조립 → publish / service call / action goal 전송

타입 케이스별 폼 매핑:
| 메시지 타입 | 폼 표현 |
|---|---|
| 기본형(int/float/string/bool) | 단일 입력 |
| 중첩 메시지(`geometry_msgs/Twist` 등) | 접이식 그룹(재귀 렌더) |
| 고정/가변 배열 | 행 추가·삭제 |
| 상수(enum 후보) | select |
| `std_msgs/Header` | stamp/frame_id 자동 채움 옵션 |
| **타입 해석 실패·미발견** | **raw YAML/JSON fallback** |

저작 시 introspect 결과(`form` 스키마)와 사용자가 채운 **기본 goal 값**을 위젯에 캐싱한다. 단 **타입 드리프트**(로봇 재빌드로 메시지 정의 변경) 대비, 실행 시 재검증해 불일치면 폼 재생성을 안내한다.

### 3.3 예시 — action 위젯
```yaml
- id: w_follow_path
  kind: control.action
  title: "경로 추종 보내기"
  pos: { x: 6, y: 0, w: 6, h: 4 }
  name: /swerve_controller/follow_path
  type: nav2_msgs/action/FollowPath   # 저작 시 introspect로 확정
  goal_form: { controller_id: "FollowPath" }   # 타입에서 생성 + 사용자 기본값
  feedback: [distance_to_goal]                 # 액션 피드백 → 미니 표시
```

---

## 4. 실행 라이프사이클 (상태머신)

프로젝트 "실행"을 누르면 아래 상태를 거친다. 각 전이는 WS로 진행상황을 push(부속 A `ws_manager` 패턴).

```
                ┌─────────┐
                │  IDLE   │  프로젝트 편집/저작
                └────┬────┘
                     │ ▶ 실행
                     ▼
        ┌───────────────────────────┐
        │ 1. RESOLVE_DESIRED         │  desired = baseline ∪ project.processes
        └────────────┬──────────────┘
                     ▼
        ┌───────────────────────────┐
        │ 2. SCAN_LIVE               │  procman: 현재 살아있는 프로세스 + introspect: 그래프
        └────────────┬──────────────┘
                     ▼
        ┌───────────────────────────┐
        │ 3. DIFF                    │  orphans = live \ desired   (baseline 제외)
        │                            │  missing = desired \ live
        └────────────┬──────────────┘
                     ▼
              orphans 있음?
            ┌────yes────┴────no────┐
            ▼                      │
  ┌───────────────────┐           │
  │ 4. CONFIRM_KILL    │ on_orphan │
  │  사용자에게 종료 동의│  =ask     │
  │  [목록+출처 표시]   │           │
  └───┬───────────┬───┘           │
   거부│        승인│               │
      ▼           ▼                ▼
   ┌──────┐   ┌─────────────────────────┐
   │ ABORT│   │ 5. KILL_ORPHANS → START │  missing required 기동
   └──────┘   │    + healthcheck(timeout)│
              └────────────┬────────────┘
                           ▼
              ┌───────────────────────────┐
              │ 6. PREFLIGHT               │  resources.require 각각:
              │   topic/service/action     │   존재? (+expect_rate_hz면 발행 중?)
              └────────────┬──────────────┘
                           ▼
                   모두 충족?
                ┌────no────┴────yes────┐
                ▼                       ▼
   ┌────────────────────────────┐  ┌──────────────┐
   │ 7. REPORT_MISSING          │  │ 8. LIVE       │
   │  • 무엇이 없는지 목록        │  │  레이아웃대로  │
   │  • 추정 원인(런치 누락 등)   │  │  실시간 렌더   │
   │  • "추가 런치/노드 정의 후    │  │  구독 시작     │
   │     재실행" 안내            │  └──────┬───────┘
   └────────────┬───────────────┘         │ ■ 정지
       사용자가 processes 보강               ▼
       → 다시 ▶ (1로 재진입)        ┌──────────────────────┐
                                   │ 9. STOP / CLEANUP     │
                                   │  provenance=project,  │
                                   │  ad-hoc 만 종료;       │
                                   │  baseline 유지         │
                                   └──────────────────────┘
```

**핵심 불변식(invariant)**:
1. **baseline은 어떤 경로로도 자동 종료되지 않는다.** (전역 E-stop과는 별개 — E-stop은 모터/액추에이터 정지이지 프로세스 kill이 아님.)
2. **출처 불명 프로세스(foreign)는 사용자 승인 없이 절대 죽이지 않는다.** (사용자 명시 요구.)
3. **리소스 "존재"와 "발행 중"은 다르다.** 런치를 켰다고 토픽이 즉시·정상 나오지 않음(타이밍·기동 실패). → preflight는 존재 + (옵션)최근 메시지 rate를 함께 본다. healthcheck는 timeout 폴링.
4. 6→7→(보강)→1 재진입은 **수렴이 idempotent**여야 성립. 이미 떠 있는 required는 다시 켜지 않는다(skip_if_running).

### 4.1 실패·에러 전이
위 상태도는 happy-path다. 각 단계의 실패는 아래로 수렴시킨다.

| 단계 | 실패 상황 | 처리 |
|---|---|---|
| 5 START | healthcheck timeout / 기동 직후 프로세스 사망 | **7 REPORT_MISSING으로 합류**("기동했으나 헬스 미통과: X"). 부분 기동분은 레지스트리에 남겨 정리 대상화 |
| 5 KILL_ORPHANS | kill 실패(권한·좀비) | 진행 차단 + 수동 개입 요청(해당 PID·cmdline 표시) |
| 6 PREFLIGHT | 일부만 충족 | 7로 가되 **충족/미충족을 분리 표시** |
| 8 LIVE 중 | required 프로세스 비정상 종료 | 해당 위젯 **degraded** 표시 + 재기동 제안(전체 abort 아님) |
| RUN_CYCLE 중 | `stop_on` 트리거 / 전역 E-stop | **즉시 중단, 카운터·부분결과 보존**해 record |
| 임의 단계 | 사용자 ABORT | 이 실행이 켠 `project`+`ad-hoc` 정리(STOP과 동일 경로) |

### 4.2 동시성·재진입
- **exclusive 충돌**: active 프로젝트가 있는데 다른 프로젝트 실행 요청 → 거부, 또는 "전환(현재 정리 후 시작)" 확인 팝업.
- **실행 중 편집**: LIVE 중 *레이아웃*(관찰 패널 추가 등)은 즉시 허용. 단 `processes`/`resources` 변경은 재수렴 필요 → "재실행해야 반영" 안내.
- **baseline 변경**(관리자, §2.5.1): active 프로젝트가 있으면 경고하고, 다음 수렴부터 반영.
- **재진입 idempotent**: 이미 떠 있는 required는 재기동 안 함(skip_if_running) → 7→보강→1 루프가 안전.
- **런타임 난입(foreign) 감지**: §2.6 주기 감시가 LIVE 중 외부 난입을 잡으면 배너 경고 → 사용자가 reconcile 재요청 가능.

---

## 5. 프로세스 출처(Provenance) — 정리의 근거

"무엇을 정리할지"를 결정하려면 각 라이브 프로세스에 **소유 태그**가 있어야 한다. procman은 자신이 기동한 프로세스에 라벨을 부여하고 레지스트리로 추적한다.

| provenance | 의미 | 수렴 시 | 정지 시 |
|---|---|---|---|
| `baseline` | persistent (zenoh/urdf/controller) | 유지 | 유지 |
| `project` | 이 프로젝트가 required로 기동 | 유지 | **종료** |
| `ad-hoc` | preflight 보강 중 임시로 켠 것 | 유지 | **종료**(cleanup_adhoc_on_stop) |
| `foreign` | testbench 밖에서 떠 있던 것(orphan 후보) | **승인 후 종료** | 건드리지 않음 |

> **Clean-Slate 부팅(§2.5) 덕에 `foreign`은 차집합으로 확정된다**: 부팅 이후 *기동 레지스트리(owned PIDs)에 없는데 살아있는 ROS 프로세스* = 런타임 중 외부에서 수동 기동된 난입. PID/cmdline 휴리스틱 "추정"이 아니라 **레지스트리 차집합**이라 정확하다. 죽일지 여부는 항상 사용자 승인(§4 단계 4).

> **기동·종료 구현 지침(2026-06-09 실증, `docs/verification-2026-06-09.md`)**: 기동은 `setsid`로 새 프로세스 그룹 생성(원격은 SSH+setsid로 세션 분리 → SSH 끊겨도 지속). 종료는 레지스트리의 **PID/PGID 기반**(`kill -TERM -<PGID>`로 launch 자식 트리 일괄 정리). **`pkill -f`류 cmdline 패턴 매칭 종료는 금지** — 자기 세션·무관 프로세스 오살 위험이 실측됨.

---

## 6. 설계 결정 (근거)

1. **동시 실행 정책** — `policy.exclusive: true` 기본. 한 번에 한 프로젝트만 active(잔여 종료 동의의 전제). 후순위로 "리소스 비충돌 시 병행 허용"을 옵션화 가능하나, 초기엔 단순·안전 우선.
2. **레이아웃 엔진** — 데스크톱 상주 전제(사용자 결정)이므로 12-col 그리드 + 드래그 리사이즈. 부속 C 9안(벤토/위젯보드)의 승격. 모바일·터치는 후순위.
3. **위젯 = 의존 리소스의 단일 출처** — 리소스를 사람이 따로 나열하지 않고 위젯에서 자동 파생(`resources.derived`)하는 게 기본. 수동 `require`는 보강용. 저작 부담↓, 누락↓.
4. **preflight ≠ 한 번** — REPORT_MISSING 후 사용자가 `processes`를 고쳐 재실행하는 루프가 1급 흐름. "무엇이 없다"에 더해 **"어느 런치가 그 토픽을 낼 법한지" 추정 힌트**를 주면 친화성↑(후순위 고도화).
5. **프리셋 개념 폐기** — 별도 프리셋 엔티티를 두지 않는다. `origin: builtin` 읽기전용 프로젝트 + **복제(duplicate)** 로 대체한다. "프리셋"은 결국 *"복제 출발점이 되는 builtin 프로젝트"* 일 뿐 구조가 동일하므로, 엔티티를 둘로 나누면 §7의 통합 의의가 다시 쪼개진다.
6. **저장 위치** — 사용자 프로젝트=JSON(`config/projects/`, 런타임 CRUD). builtin 프로젝트=YAML(`config/projects/builtin/`, git-tracked, 읽기전용 시드). 스냅샷(DESIGN §6)은 프로젝트로 흡수·폐기.
7. **합/불 판정은 human-in-the-loop** — 툴은 관찰(플롯)·반복(`runner`)·기록(`record`)·**수동 verdict 입력**까지만 책임진다. 자동 판정식(임계 평가 등)은 두지 않는다. 하드웨어팀 테스터가 라이브 데이터를 보고 직접 PASS/FAIL·코멘트를 남기면 record(L6)에 박제. **근거**: 판정 기준은 테스터의 도메인 지식 영역(사용자 결정).

---

## 7. 기존 DESIGN과의 정합 (승격 / 통합 / 폐기)

| DESIGN 현행 | 본 모델에서 |
|---|---|
| §4.3 `profile` | 프로젝트의 `processes`로 **흡수** |
| §4.3 `subsystem` (controls/telemetry/sensors_state) | 위젯(제어/플롯/상태)으로 **분해 흡수**. 서브시스템 묶음을 builtin 프로젝트로 제공 가능 |
| §4.3 `test` (cycle/record/prerequisites) | 프로젝트의 `runner`(반복/시퀀스, §2-E) + `record`(§2-F)로 **흡수** |
| §6 `snapshots/*.json` | 프로젝트로 **승격·폐기** |
| 부속 B 52테스트 | **구현하지 않음** — 확장성 요구 도출용 참고자료. builtin은 간단 튜토리얼 1~2개만 |
| §8.1 네비 9개 | "프로젝트 목록 / 프로젝트 편집·실행 / 시스템·인프라 / 데이터 자산" 중심으로 **축소** |
| L0~L7 레이어 (§4.1) | 백엔드 구현 개념으로 **유지**(UI엔 비노출) — procman(수렴)·introspect(preflight)·monitor(plot.system)·recorder가 본 모델을 받친다 |

---

## 8. 미해결 / 검증 항목 (DESIGN §12에 합류)

1. ~~수렴의 안전 경계(foreign 식별 정확도)~~ → **해소**: Clean-Slate 부팅(§2.5) + owned-registry 차집합(§5)으로 `foreign`을 확정. 남은 과제는 게이트/난입 감지용 ROS 프로세스 판별 패턴(§2.6)의 완성도(특히 launch 자식 프로세스 트리 추적)뿐.
2. **healthcheck ↔ preflight 중복** — 둘 다 "토픽 떴나"를 보지만 시점(기동 직후 vs 렌더 직전)이 다름. 통합 폴러로 단일화할지.
3. **위젯→리소스 파생의 type 해석** — 발행 위젯의 동적 폼 생성은 런타임 메시지 타입 introspection 필요(부속 A `manifest`/introspect).
4. **프리셋 ↔ 라이브 인터페이스 드리프트** — 52테스트 프리셋의 토픽/서비스 이름은 플레이스홀더(부속 B §6). 로봇 기동 후 실측으로 확정.
5. ~~반복 내구성 표현 방식~~ → **결정**: 프로젝트 레벨 `runner`(§2-E)가 `control.*` 위젯을 id로 참조해 cycle/sequence 구동. 위젯=동작 단위, runner=오케스트레이션. **합/불 판정은 자동화하지 않음** — 테스터 수동 verdict(§6-7).
```
