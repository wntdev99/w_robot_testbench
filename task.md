# w_robot_testbench 작업 기록 (task.md)

> 브랜치: `feat/testbench` · 최종 갱신: 2026-06-09
> 설계 SSOT: `DESIGN.md`(v0.3) + 부속 D `docs/test-project-model.md`

---

## ✅ 완료한 작업 (순차)

1. `feat/testbench` 워크트리 단독 진행 — **main 워크트리 구현물은 무시(merge 안 함)**
2. 기존 docs 3종(부속 A 도구권장 / B 52테스트매핑 / C 와이어프레임) + DESIGN v0.2 정독
3. **핵심 패러다임 확정**: "테스트 프로젝트" = 사용자가 GUI로 런타임 저작하는 1급 객체
4. 부속 D(`docs/test-project-model.md`) 신규 작성 — 데이터모델·실행 라이프사이클 SSOT
5. 부속 D 보강: 위젯 동적폼(§3), 에러·동시성 전이(§4), 반복 러너 `runner`(§2-E)
6. 합의 반영: **프리셋 폐기**(origin:builtin+복제), **Clean-Slate 부팅 게이트** + **owned-registry 단일소유권**, **동적 baseline**(빈집합 허용)
7. **합/불 판정 = human-in-the-loop** 결정 (자동 판정식 없음, 수동 verdict)
8. **52테스트 = 확장성 참고자료**(구현 대상 아님), builtin은 간단 튜토리얼 1~2개로 정정
9. **텔레옵도 프로젝트로 흡수** — 경계 확정(운영=프로젝트 / 셸=인프라·모니터·안전·관리)
10. DESIGN v0.3 신규 작성 (§1 목표 ~ §12 미해결, 324줄)
11. **2-트랙 모드 토글 폐기** — 편집↔실행 상태로 흡수(§8)
12. 메모리 동기화(test-project-paradigm / hardware-test-plan-driver 등)
13. 커밋 완료 (`e388a2f` DESIGN v0.3, 부속 D는 `05df77b`에 포함 검증)
14. task.md 작성·커밋 (`d631ea4`)
15. **실로봇 아키텍처 4대 가정 검증**(2026-06-09) — zenoh·SSH무인·프로세스식별·introspection + cmd_vel=Twist·diagnostics 전부 ✅. 202→201 SSH 키 배포. 기록: `docs/verification-2026-06-09.md` + `scripts/verify_assumptions.sh`
16. **프로세스 기동·종료 검증**(reconciler 심장) — 로컬 단일/그룹(PGID 트리)·원격 기동/지속(setsid)/PID종료 전부 ✅. 구현 지침 도출: setsid 기동 + PID/PGID 종료, `pkill -f` 금지(오살 실측)
17. **Clean-Slate + baseline 기동 end-to-end 실증**(백엔드 mock) — 실가동 런치 전부 종료(202·201=0) → zenoh·robot·control 순차 기동+healthcheck 전부 ✅ → baseline 노드만 복구. 스크립트: `scripts/bootgate_test_{202,201}.sh`
18. 검증 종료 — 테스트 baseline 전부 종료(202 노드 0, 202·201 ROS proc 0, 로봇 정리). 검증 커밋: `ab7b791`(4대가정)·`d150268`(프로세스)·`89563b4`(부트게이트)
19. **P0 스캐폴딩 완료** (`fa50f9c`) — 백엔드(FastAPI+rclpy 골격, bt_gui 패턴 계승, py_compile ✅) + 프론트(Next.js14+TS+Tailwind 셸, build ✅). boot_gate/api/ws_manager/config + 셸(Sidebar·StatusPulse·EmergencyStopBar)·디자인토큰·빈 라우트 5
20. **의존성 자동화(rosdep)** (`98b0255`) — bt_gui 맹목계승 대신 리서치 후 rosdep 채택. `package.xml`=SSOT, ament_python(setup.py). 새 머신=`rosdep install` 한 줄
21. **P0 백엔드 202 실증** (`0d2f629`) — rosdep+apt 설치 ✅ → `colcon build` ✅ → `ros2 run w_robot_testbench testbench` 기동 ✅ → API 3종 응답, `baseline.yaml` 3개 로드, **PREBOOT_SCAN이 24개 ROS(202 풀스택+201 control) 정확 감지**. 버그 수정: setup.cfg(ros2 run 인식)·config 경로(ament share). fastapi 0.101 호환 OK
22. **P1 인프라 구현+202 검증** (`a482ff1`) — procman(spawn/kill/owned)·baseline 오케스트레이터·`/api/baseline`·`/api/system/controller`. 검증: idempotent skip ✅, 201 stats(loadavg/temp SSH) ✅, resolve kill ✅, baseline up spawn 순차 ✅. **발견: zenoh를 reconcile로 죽이면 백엔드 bridge 재연결 안 됨→healthcheck 먹통** → zenoh=인프라 전제(reconcile 예외)로 보정 필요(부속 D §2.5.1 기록)
23. **zenoh 예외화 보정+재검증** (`67cecf3`) — OwnedProcess.persistent, baseline_down/boot_gate.resolve가 zenoh(rmw_zenohd) 보존. 재검증: zenoh 전제기동→baseline up `{zenoh:skipped, robot_urdf:ok, controller:ok}`(**healthcheck 통과, 이전 timeout 해결**)→풀스택 복구→down시 `zenoh ALIVE 보존`. **P1 인프라 완결**

---

## ⬜ 앞으로 진행할 작업

### 선행 (구현 전 확인 · DESIGN §12)
- [x] ~~zenoh 단일성 검증~~ ✅ 202 라우터 1개 + 201 클라이언트(connect 202:7447), 202에서 201 노드 가시
- [x] ~~202→201 SSH 무인 인증 키 배치~~ ✅ (2026-06-09 키 배포). 단 제품 서버는 admin 부트스트랩으로 일반화 필요
- [x] ~~타입 introspection / cmd_vel·diagnostics 확인~~ ✅ cmd_vel=Twist, /diagnostics(can2:N key-value)
- [ ] 202에 `fastapi`/`uvicorn`/`asyncssh` pip 설치
- [ ] 201 시스템 stats 경로(ROS2 토픽 / SSH psutil fallback) 확인
- [ ] (런타임 발견 원칙) 도어/컨베이어/암/카메라·충전 인터페이스 — 박제 X, 해당 프로젝트 저작 시 introspect

### 구현 로드맵 (DESIGN §11)
- [x] ~~**P0 스캐폴딩**~~ ✅ (`fa50f9c`) 백엔드 py_compile + 프론트 build 통과. 백엔드 실제 기동은 202 pip 설치 후
- [ ] **P1 인프라+텔레옵 프로젝트** — 동적 baseline·zenoh·autostart(SSH)·시스템모니터·201토폴로지 / **builtin 텔레옵 프로젝트 실행**(수렴·preflight·라이브) / joint_states·모터온도 plot / controller switch·직접명령
- [ ] **P2 프로젝트 저작 UI** — 레이아웃 빌더(그리드·위젯 팔레트), 위젯 동적폼(introspect), 프로젝트 CRUD·복제
- [ ] **P3 수렴·preflight 완성** — reconciler(orphan 승인 종료)·preflight(존재·발행)·report_missing 보강 루프·owned-registry/난입 감지
- [ ] **P4 러너+자산화** — runner(cycle/sequence)·record(CSV/JSON·counters·수동 verdict)·데이터 자산 페이지
- [ ] **P5 전장부+진단+카메라** — BMS/Elyx 위젯·diagnostics·CAN 진단 / MJPEG/WebRTC·fps·USB허브

### 설계 잔여 (부속 D §8)
- [x] ~~**zenoh reconcile 예외화**~~ ✅ (`67cecf3`) persistent 플래그로 boot_gate.resolve/baseline_down이 zenoh 보존. 재검증서 robot/control healthcheck 통과 확인
- [x] ~~boot_gate self/owned 제외~~ ✅ P1에서 owned_registry + getpid/getppid 제외 구현(`2bec20b`)
- [ ] 난입(foreign) 판별 패턴 — launch 자식 프로세스 트리 추적
- [ ] healthcheck ↔ preflight 폴러 통합
- [ ] 발행 위젯 메시지 type 해석(introspection) 구현 방식
- [ ] 부속 A/B/C 정합성 점검 — 특히 부속 C는 "v0.3 §8이 최신"임을 노트
