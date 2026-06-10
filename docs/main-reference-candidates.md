# main 브랜치 참고 후보 (이식 보류 — 백로그)

> main 워크트리(`w_robot_testbench`, 별도 에이전트 작업물, **merge 안 함**)를 조사해
> 우리 feat/testbench의 "테스트 프로젝트 = 사용자 저작 위젯 카탈로그" 패러다임에
> **이식·일반화할 가치가 있는 항목**만 추린 목록. 실제 이식은 추후 결정.
> (조사일 2026-06-10. main 경로 기준 `frontend/src/components/panels.tsx` ~1271줄)

## 이미 이식 완료
- **텔레옵 패드** → `control.teleop` 위젯으로 일반화 완료(화면패드/게임패드/키보드 3소스,
  데드맨·스프링복귀·REP-103·속도상한, live 게이트). builtin `teleop.yaml` 적용. (`f7f20e5`)

## 우리가 이미 보유 (이식 불필요)
- **카메라 MJPEG 스트림**: `ImageView` + `/api/camera/stream`(multipart, CompressedImage/Image raw+pillow) — 동등.
- **그리드 드래그 배치**: react-grid-layout `WidgetGrid`로 해결(main은 @dnd-kit SortableHandleContext).
- **E-STOP**: `emergency` API + `EmergencyStopBar` 보유.
- **컨트롤러 조작 / 부팅 게이트 / baseline**: 백엔드·페이지로 보유.

## 이식 후보 (가치순)

### ① nav 위젯 — 가장 큰 기능 공백 · 가치 상 / 난이도 상
- **무엇**: Canvas 2D 맵 + LaserScan/footprint/로봇 자세 오버레이 + 클릭으로 2D Pose / Nav2 Goal 전송 + 주행 취소(액션 cancel). 휠 줌 / 드래그 팬, world↔canvas 좌표변환.
- **main 구현**: `frontend/src/components/panels.tsx:524-713`(NavWidget), `backend/testbench/api/nav.py:1-49`.
- **이식 메모**: 우리는 ActionCaller·SubscriberPool 보유 → 백엔드 대부분 재사용 가능. Canvas 드로잉이 주 작업. 위젯 종류 `nav`(또는 `view.map`)로 카탈로그 추가. nav2 미가동 환경에선 preflight로 게이트.

### ② command 위젯 JSON 직접 입력 모드 — 가치 중 / 난이도 하 (가성비 최고)
- **무엇**: publish/service/action에서 폼 외에 **JSON textarea 직접 편집** 모드. 배열·복합 타입·타입 미상 시 유용.
- **main 구현**: `frontend/src/components/panels.tsx:1140-1215`(jsonMode/jsonText, `hasArray || fields.length===0` 시 토글, `JSON.parse` vs buildPayload).
- **이식 메모**: 우리 `ControlPub/ServiceCall/ActionCall`에 체크박스+textarea+try-catch 파싱 추가. 백엔드 변경 불필요(`api.publish/serviceCall/actionCall`가 이미 dict 수신).

### ③ 시스템 메트릭 플롯 (`plot.system`) — 가치 중 / 난이도 하
- **무엇**: CPU/메모리/온도/네트워크/지연을 카테고리 자동 그룹핑해 실시간 플롯.
- **main 구현**: `frontend/src/components/panels.tsx:49-78`(systemFields, systemCategories, SYS_GROUPS 규칙).
- **이식 메모**: 우리는 시스템 상태를 `/system` 페이지에 분리 보유. 위젯 종류 `plot.system` 신설 시 워크스페이스 내 플롯 가능. `/api/system/status` 스냅샷 → leaf 경로 추출 → 카테고리화 로직만 이식.

## 부수 UX 패턴 (낮은 우선순위)
- **StartupPrompt**: 서버 기동 시 "기존 ROS 종료→baseline 기동" 계획 승인 모달. 우리 `bootStatus/bootResolve` API와 동일 개념 → 모달 UX로 통합 가능. (`frontend/src/components/StartupPrompt.tsx`)
- **Recorder 위젯화**: main은 녹화를 위젯으로(토픽 다중선택+실시간 행/초+CSV 즉시 다운로드). 우리는 `data` 페이지 분리 — 워크스페이스 내 즉시 조작 UX 참고. (`panels.tsx:754-848`)
- **StatusBar 통합 대시보드**: 연결/Zenoh/Controller/CPU/온도 한 줄 표시 패턴. (`StatusBar.tsx`)

## 제외 (패러다임 차이)
- controllers 위젯(controller_manager 직접 조작), LaunchWidget(런치파일 발견/실행 — 우리는 process 위젯), workspace 스냅샷(우리는 Project YAML 중심) — 별개 개념이라 그대로 차용 부적합.
