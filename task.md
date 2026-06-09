# w_robot_testbench 작업 기록 (task.md)

> 브랜치: `feat/testbench` · 최종 갱신: 2026-06-09
> 설계 SSOT: `DESIGN.md`(v0.3) + 부속 D `docs/test-project-model.md`

---

## ✅ 완료한 작업 (순차)

1. `feat/testbench` 워크트리 생성 (main은 다른 에이전트 작업, 격리 진행)
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

---

## ⬜ 앞으로 진행할 작업

### 선행 (구현 전 확인 · DESIGN §12)
- [ ] **로봇 기동 상태에서 라이브 인터페이스 실측** — 도어/컨베이어/암/카메라 등 실제 토픽·타입·서비스·액션 (현재 OFF, 위젯 name 플레이스홀더)
- [ ] 202에 `fastapi`/`uvicorn`/`asyncssh` pip 설치
- [ ] 202→201 SSH 무인 인증 키 배치
- [ ] zenoh 단일성(202 라우터 1개, 201 클라이언트) 검증
- [ ] 201 시스템 stats 경로(ROS2 토픽 / SSH psutil fallback) 확인

### 구현 로드맵 (DESIGN §11)
- [ ] **P0 스캐폴딩** — 레포 골격, FastAPI+rclpy(ros_bridge/ws_manager 이식), Next.js14, 디자인토큰, 전역 상태바+E-stop, **boot_gate**
- [ ] **P1 인프라+텔레옵 프로젝트** — 동적 baseline·zenoh·autostart(SSH)·시스템모니터·201토폴로지 / **builtin 텔레옵 프로젝트 실행**(수렴·preflight·라이브) / joint_states·모터온도 plot / controller switch·직접명령
- [ ] **P2 프로젝트 저작 UI** — 레이아웃 빌더(그리드·위젯 팔레트), 위젯 동적폼(introspect), 프로젝트 CRUD·복제
- [ ] **P3 수렴·preflight 완성** — reconciler(orphan 승인 종료)·preflight(존재·발행)·report_missing 보강 루프·owned-registry/난입 감지
- [ ] **P4 러너+자산화** — runner(cycle/sequence)·record(CSV/JSON·counters·수동 verdict)·데이터 자산 페이지
- [ ] **P5 전장부+진단+카메라** — BMS/Elyx 위젯·diagnostics·CAN 진단 / MJPEG/WebRTC·fps·USB허브

### 설계 잔여 (부속 D §8)
- [ ] 난입(foreign) 판별 패턴 — launch 자식 프로세스 트리 추적
- [ ] healthcheck ↔ preflight 폴러 통합
- [ ] 발행 위젯 메시지 type 해석(introspection) 구현 방식
- [ ] 부속 A/B/C 정합성 점검 — 특히 부속 C는 "v0.3 §8이 최신"임을 노트
