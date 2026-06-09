# 하드웨어 테스트 계획 → 테스트벤치 역량 매핑

> 하드웨어팀 테스트 계획서(Mw/JW, 52개 테스트)를 분석해, 테스트벤치가 **최종적으로 지원해야 할 S/W 역량**을 도출하고
> 이를 수용하도록 카테고리·아키텍처를 일반화한다.
> 출처: 하드웨어팀 테스트 정의 문서 (제품/모듈명/테스트명칭/주행여부/파손가능성/S·W 필요기능/선행과제/담당자/소요일수/준비물/주차).
> 전제: `bt_web_bridge`는 BehaviorTree 종속이므로 **패턴(FastAPI+rclpy, ws_manager, manifest, self_check, emergency)만 계승하고 BT 결합은 버린다.**

---

## 1. 서브시스템별 분류 (52개)

| 모듈 | No. | 테스트 | 주행 | 파손 | 핵심 S/W 필요 기능 |
|---|---|---|:--:|:--:|---|
| **Swerve** | 1 | 서스펜션 볼트 | O | | 텔레옵 |
| | 2 | 서스펜션 성능 | O | | 텔레옵 |
| | 3 | 0점 부품 | O | | 텔레옵 |
| | 4 | 조향 토크 | O | | 텔레옵 + **조향모터 전류·온도·토크 측정** |
| | 5 | 조향모터 0점 | | | **모터 회전 제어**(0점) |
| | 6 | 타이어 접지 | O | | 텔레옵 |
| | 7 | 쇼바 볼트 녹 | | | — (소금물, 기계) |
| **Arm** | 8 | Station 도킹 간섭 | O | | **도킹 시퀀스** + 뒷문 Open |
| | 9 | 배선 단선 | | O | **Arm 트레잭토리 구동** |
| | 10 | 팔·단축로봇 떨림 | O | | 텔레옵 |
| | 11 | 수직 이동 | | | **단축로봇(Lift) 구동** + 팔 구동 + 핸드아이(카메라) |
| 로봇통합 | 12 | Station Mw 택배 이송 | | | 도킹 + **택배 이송 시퀀스** |
| **컨베이어** | 13 | 선 찝힘 | | O | **컨베이어 구동** + IRED + **로드셀 무게 감지** |
| | 14 | 사행 | | O | 컨베이어 구동 |
| | 15 | 로드셀 | | O | **로드셀 튜닝·무게 감지** |
| **Door** | 16 | 뒷문 소음 | O | | **뒷문 제어** + 텔레옵 |
| | 17 | 뒷문 내구성 | O | O | **뒷문 모터 힘 주기/풀기** + 텔레옵 |
| | 18 | 뒷문 구동 | | | 여닫기 / 힘 풀기 / **홀센서 0점** / **반복 1000회** |
| | 19 | 옆문 내구성 | | O | 옆문 Open/Close / **솔레노이드** / **마이크로스위치 인지** |
| | 20 | 옆문 소음 | O | | 옆문 Open/Close + 텔레옵 |
| | 21 | 옆문 모터 수동/자동 | | | **반복 100회** / Close |
| | 22 | 옆문 구동 | | | Open/Close / **모터 전류·토크 측정** / 솔레노이드 / 스위치 / **토크 제어[중력보상]** |
| 천장 | 23 | 천장 소음 | O | | 텔레옵 |
| **전자부품** | 24 | LCD 해상도 | | | LCD 해상도 확인 (별도) |
| | 25 | USB 안정성 | | | **카메라 영상처리[주행모드]** |
| | 26 | 카메라 6대 동시 | | | **영상처리[최대전력] / 끊김 인지 / fps 그래프 추출[depth,rgb]** |
| | 27 | USB HUB 제어 소생 | | | 카메라 확인 / **USB HUB 포트 제어** / **끊김 횟수 측정** / 소생 |
| | 28 | 초음파 | | O | **초음파 센서 값 측정** |
| | 30 | 범퍼(본드) | O | | 텔레옵 + **범퍼 동작시 정지 우선(안전)** |
| | 31 | 무선충전 모듈 | | | **모터 온도** + 텔레옵 + **충전 전류 체크** |
| | 32 | 범퍼(우레탄) | O | | 텔레옵 + **범퍼 정지 우선** |
| | 33 | 무선충전 시간/배터리 소생 | | | **대기 상태 + 배터리 모니터** |
| | 34 | 무선충전 CAN 정보 | | | **무선충전 CAN 정보 측정** |
| **회로** | 36 | CM4 부팅 | | | (OS/펌웨어, 경계) |
| | 38 | 센서 CAN 통합회로 | | | **CAN 통합 모니터** |
| **배선** | 39 | CAN 통신 안정성 | | | **모든 CAN 연결 + 끊김 횟수 측정** |
| **LED** | 41 | 헤드라이트 | | | 카메라 장애물 인식 + **W.PD Magnet 제어** |
| **JW 하차** | 49 | Zip Chain 성능 | | O | **Hightorque 모터 제어** |
| **JW 전자** | 50 | FAN 공기순환 | O | | 텔레옵 + **CPU 온도 체크** |

**S/W 무관(범위 외)**: 7(녹·소금물), 35(도색 신뢰성), 37(B.PD 전력), 40(IPX 방수), 42~47(제품화 재설계), 48(Lift 와이어 기구), 51(Piper Arm 장착), 52(LM가이드 기구). 24/29(LCD)는 디스플레이 검수로 경계.

---

## 2. 도출된 S/W 역량 분류 (중복 제거)

| ID | 역량 | 빈도 | 대표 테스트 |
|---|---|:--:|---|
| **A** | 조이스틱 텔레옵(주행) | ~14 | 1·2·3·6·10·16·17·20·23·30·32·50 |
| **B** | 모터 직접 제어 (회전/위치/0점/토크/중력보상/Hightorque) | 5 | 5·18·22·49 |
| **C** | 모터 텔레메트리 플롯 (전류/온도/토크/RPM) | 5 | 4·22·31·5 |
| **D** | 액추에이터 서브시스템 구동 (도어/컨베이어/리프트/암/솔레노이드/헤드라이트) | 14 | 8·9·11·13·14·16~22·41 |
| **E** | **반복 내구성 사이클 러너** (횟수 지정 자동반복 + 카운트) | 2+ | 18(1000회)·21(100회) |
| **F** | 센서/스위치 상태 모니터 (홀센서/마이크로스위치/IRED/로드셀/초음파/범퍼) | 8 | 13·15·18·19·22·28·30 |
| **G** | 충전·배터리 모니터 (충전전류/CAN/SOC/소생) | 4 | 31·33·34 + BMS |
| **H** | 카메라/영상 (멀티스트림/fps 플롯/이미지뷰/핸드아이/USB허브 포트제어) | 6 | 11·25·26·27·41 |
| **I** | 도킹 시퀀스 | 2 | 8·12 |
| **J** | CAN 통신 진단 (연결상태/끊김 횟수 카운트) | 4 | 13·27·34·38·39 |
| **K** | 데이터 자산화 (측정 그래프 / CSV·JSON / 이벤트·끊김 카운트 기록) | 다수 | 26·27·39 + 모든 측정 |
| **L** | 안전 (전역 E-stop / 범퍼 정지 우선 / 파손가능성 경고) | 4+ | 30·32·17·19 |

테스트 운영 메타(역량 아님, 관리용): 주행여부·소요시간·파손가능성·**선행과제**·담당자·소요일수·준비물·주차·**타테스트 동시가능여부**.

---

## 3. 역량 → 플랫폼 구조 매핑 (일반화)

핵심 통찰: **Swerve/BT에 하드코딩하지 않고, "서브시스템 모듈 + 공통 역량 레이어 + 테스트 런 엔진"으로 일반화**한다. 새 서브시스템(도어/컨베이어/암…)이 늘어도 **manifest 추가만으로 확장**된다.

### 3.1 공통 역량 레이어 (플랫폼)

```
L0 인프라/오케스트레이션 : zenoh·autostart·프로파일 묶음·201 SSH         (요구 기존)
L1 안전                  : 전역 Emergency Stop + 범퍼/정지우선 훅         (역량 L)
L2 텔레옵                : 조이스틱 주행 공통 모듈                        (역량 A)
L3 측정·플롯 엔진        : 토픽/모터텔레메트리/센서/fps → uPlot 시계열     (역량 C·F·G·H-fps)
L4 명령 인터페이스       : publish/service/action 친화 폼(zod 스키마)     (역량 B·D·I)
L5 테스트 런 엔진        : 반복 카운트·선행과제 검사·합·불 판정·결과 기록  (역량 E·K + 운영메타)
L6 데이터 자산화         : CSV/JSON·이벤트/끊김 카운터·스냅샷             (역량 J·K)
L7 카메라/영상           : MJPEG/WebRTC 스트림·이미지뷰·USB허브 제어       (역량 H)
```

### 3.2 서브시스템 모듈 (manifest 선언형, 확장 단위)

각 서브시스템은 YAML manifest로 "런치 프로파일 + 제어 위젯 + 텔레메트리 + 적용 테스트"를 선언:

```yaml
# config/subsystems/door.yaml
subsystem:
  id: door
  label: "도어 (뒷문/옆문)"
  launch_profile: door_test          # profiles/door_test.yaml 참조
  controls:                          # → L4 친화 폼/버튼으로 렌더
    - { id: rear_open,  label: "뒷문 열기",  kind: service, name: /door/rear/open }
    - { id: rear_close, label: "뒷문 닫기",  kind: service, name: /door/rear/close }
    - { id: rear_force, label: "뒷문 힘 주기/풀기", kind: topic,
        name: /door/rear/effort, type: std_msgs/Float64 }
    - { id: side_sol,   label: "솔레노이드", kind: service, name: /door/side/solenoid }
  telemetry:                         # → L3 플롯 / L6 기록 대상
    - { topic: /door/rear/motor/current, plot: true }
    - { topic: /door/rear/hall,          kind: state }
    - { topic: /door/side/microswitch,   kind: state }
  sensors_state:                     # → L1 안전/이벤트 카운트
    - { topic: /bumper/triggered, on_true: estop }
```

### 3.3 테스트 카탈로그 (52개 선언형) + 런 엔진

```yaml
# config/tests/door_durability.yaml   (No.18 뒷문 구동)
test:
  id: door_rear_durability
  subsystem: door
  title: "뒷문 내구성 (반복 1000회)"
  driving: false
  damage_risk: false
  prerequisites: []                   # 선행과제 → 미충족 시 실행 차단
  owner: 박진
  required_profiles: [door_test]      # exclusive 기동
  cycle:                              # ← L5 반복 러너
    action: { open: /door/rear/open, close: /door/rear/close }
    count: 1000
    settle_s: 1.5
  record:                             # ← L6 자산화
    topics: [/door/rear/motor/current, /door/rear/hall]
    export: [csv]
    counters: [cycle_count, hall_zero_events]
```

런 엔진: 선행과제 검사 → 필요 프로파일 exclusive 기동 → 반복/시퀀스 수행 → 텔레메트리 기록 → 합/불 판정 → 결과를 sqlite(history)+CSV로 박제. **이 구조가 가이드 위저드(8안)·스냅샷·자산화 요구를 한 번에 충족.**

---

## 4. 개정 카테고리 (메인 페이지)

기존 6 카테고리를 **플랫폼 레이어 + 서브시스템 모듈 + 테스트 카탈로그** 3축으로 재정렬:

1. **대시보드(홈)** — 상태 카드, 활성 프로파일, 전역 E-stop, 빠른 시작
2. **시스템/인프라** — zenoh·autostart·202/201 모니터·CAN 진단(역량 J)
3. **런치 오케스트레이션** — 프로파일 묶음(exclusive)·201 SSH
4. **텔레옵** — 주행 공통(역량 A)
5. **서브시스템 제어** — Swerve·Arm/Lift·Door·Conveyor·무선충전·카메라·LED (manifest 기반, 역량 B·D·F·G·H·I)
6. **측정·플롯** — 모터 텔레메트리/센서/fps/joint_states (역량 C·F, uPlot)
7. **테스트 카탈로그·런** — 52 테스트 선언·반복러너·합불판정(역량 E·K + 운영메타)
8. **데이터 자산** — CSV/JSON·카운터·스냅샷·실행이력(역량 K)
9. **명령(고급)** — 임의 publish/service/action 폼(역량 L4)

> 서브시스템·테스트는 **manifest 추가만으로 확장**되므로, 화면을 늘리지 않고 52개(이후 추가분 포함)를 모두 수용한다.

---

## 5. bt_web_bridge에서 취할 것 / 버릴 것

| 취함 (패턴 계승) | 버림 (BT 종속) |
|---|---|
| FastAPI+rclpy+uvicorn 골격, executor 스레드 | `/bt_execution` 단일 ActionClient 고정 |
| `ws_manager` broadcast + welcome snapshot | bt_schema_server 의존 |
| `manifest_loader`(.meta.yaml) → 서브시스템/테스트 manifest로 일반화 | ExecuteTree 액션·트리 스키마 |
| `self_check`(startup drift, fail-fast) → 프로파일/토픽 존재 검증 | BT 노드모델 drift |
| `scenario_storage`(YAML) → 테스트·스냅샷 저장 | 시나리오=BT 시퀀스 가정 |
| `history_db`(sqlite) → 테스트 결과/측정 이력 | — |
| `emergency.py` 전역 E-stop (모터·도어·컨베이어에 필수) | goal cancel 한정 → 다중 액추에이터 정지로 확장 |
| Next.js14+Tailwind+shadcn/ui, useWebSocket, ParamForm | react-flow(BT 그래프 전용) 선택적 |

---

## 6. 범위·검증 주의

- **역량 D/F/H의 실제 토픽·서비스·액션 인터페이스는 미실측** — 도어/컨베이어/암/카메라 드라이버가 어떤 ROS 인터페이스를 노출하는지 로봇 기동 후 확인 필요(현재 OFF). manifest의 control/telemetry 이름은 **플레이스홀더**.
- 카메라(역량 H)는 텍스트 플롯과 별개 파이프라인(영상 스트림) — 별도 설계 필요.
- 일부 테스트(LCD/CM4/도색/방수)는 S/W 비중 낮음 → 우선순위 후순위.
- **즉시 구현(P1)은 변동 없음**: autostart + 텔레옵 + joint_states/온도 플롯. 본 문서는 *최종 확장성*을 보장하는 골격 설계.
