# w_robot_testbench

웹 기반 ROS2 로봇 테스트벤치 — **FastAPI + rclpy** 백엔드 / **Next.js 14** 프론트. 설계 SSOT: [`DESIGN.md`](DESIGN.md).

로봇 네트워크(Wi-Fi)에 접속해 브라우저로 `http://<서버IP>:<포트>` 접속 → 패널을 조립해 로봇을 제어·관측·녹화하는 Toss풍 도구.

## 화면 구성
사이드바: **대시보드 · 워크스페이스 · 관리자** + 워크스페이스 하위에 저장된 스냅샷 목록. 상단 전역 **상태바 + E-stop 바**.

- **대시보드** — 한눈 상태(zenoh/201 연결/인터넷/E-stop), 서버(202)·컨트롤러(201) 카드, 실행 중 런치 스캔, 저장된 스냅샷·프로파일 빠른 진입, 최근 녹화
- **워크스페이스** — 빈 화면에서 시작, **패널을 추가/드래그 재배치**해 구성. 구성은 스냅샷으로 저장/복원(사이드바에서 클릭 진입, 덮어쓰기 지원)
- **관리자** — 시작 플랜(아래) 편집·적용

### 워크스페이스 패널 종류
| 패널 | 기능 |
|---|---|
| **플롯** | 토픽/시스템 데이터 시계열(uPlot). 시스템은 카테고리(CPU/메모리/온도/네트워크/지연/연결)별 선택. `표`/`그래프` 토글. JointState는 조인트명 라벨 |
| **Diagnostics** | `/diagnostics` 항목 — 항목별/기기별 카테고리, 표/그래프 |
| **카메라** | 이미지 토픽 → MJPEG 라이브 뷰(RGB/Depth, cv_bridge) |
| **네비게이션** | RViz풍 2D — map/scan/footprint/robot pose(Canvas, pan·zoom), **2D Pose Estimate·Nav Goal·주행 취소** |
| **텔레옵** | 화면 XY패드+회전 슬라이더 / **게임패드(W3C Gamepad API)** — 데드맨 LT, 좌스틱 이동·우스틱 회전, RB로 횡이동, 스틱·버튼 시각화 |
| **명령** | publish / service / action 동적 폼(타입 introspection 기반) |
| **런치** | 설치된 launch 파일 런타임 발견(서버/201) → 실행·종료, 실행 중 런치 스캔, 프로파일 묶음 |
| **컨트롤러** | controller_manager 목록 + 활성/비활성 |
| **녹화(Recorder)** | 토픽/diagnostics/시스템을 백엔드 풀레이트로 녹화 → **Wide CSV** 다운로드 |

## 주요 동작
- **실시간 데이터**: 토픽 동적 구독 + `/diagnostics` 파싱 → WebSocket 스트림. 시스템 모니터(psutil/온도/네트워크/인터넷/지연 ping).
- **프로세스 오케스트레이션**: 로컬(202) subprocess + 컨트롤러(201) SSH. 런치 발견/실행/종료, 실행 중 스캔.
- **시작 플랜(관리자)**: 기존 ros2 일괄 종료(202+201) → zenoh 확인·기동 → baseline 프로세스를 순서·간격대로 기동. **부팅 시 파괴적이므로 자동 실행하지 않고 웹 팝업으로 승인** 후 실행.
- **안전**: 전역 Emergency Stop(cmd_vel 0 + 컨트롤러 비활성 + nav 액션 취소). 텔레옵 데드맨. 모터/주행 동반 동작은 confirm.

## 실행

### 1. 백엔드 (서버=202 또는 개발 PC, ROS2 Jazzy + `rmw_zenoh_cpp` 소싱)
의존성은 **rosdep로 apt 설치**합니다 (PEP 668 회피, `pip` 불필요). 모두 apt 패키지로 제공됨:
fastapi/uvicorn/pydantic/psutil/yaml/opencv + rclpy/rosidl_runtime_py/tf2_ros/cv_bridge.
```bash
./scripts/install_deps.sh                 # rosdep install (없으면 apt 직접). 1회
# 수동: rosdep install --from-paths backend --ignore-src -r -y --skip-keys ament_python

cd backend
python3 -m testbench.main                 # config/testbench.yaml 의 host:port (기본 0.0.0.0:8080)
# 임의 포트: python3 -m testbench.main --port 8099
```
**중지(서버 끄기):**
```bash
# 포그라운드로 띄운 경우: 해당 터미널에서 Ctrl+C
# 백그라운드/다른 터미널인 경우:
pkill -f testbench.main                    # 매치 없으면 종료코드 1(무해)
```
- `backend/`는 ament_python 패키지(`package.xml`)라 colcon 워크스페이스에 넣어 `colcon build` + systemd 배포도 가능.
  (설치 경로 배포 시 `TESTBENCH_CONFIG_DIR`로 config 위치 지정. systemd 배포면 `systemctl stop`으로 중지)
- 시작 플랜 자동 실행은 `config/startup.json`의 `auto_on_boot`로 제어(부팅 시 팝업 승인). `TESTBENCH_NO_AUTOSTART=1`로 무시 가능.
- ⚠ apt `python3-pydantic`은 v1 — 코드는 v1/v2 모두 호환.

> **관측 ≠ 제어.** 테스트벤치 서버를 켜면 zenoh 클라이언트로 로봇 네트워크(202)에 붙어 **이미 실행 중인** 토픽/diagnostics가 화면에 채워집니다 — 이는 testbench가 로봇을 켠 것이 **아닙니다**. 로봇/노드를 실제로 기동·종료하는 경로는 **① 시작 플랜(`auto_on_boot:true`일 때 부팅 후 팝업 승인 / 관리자 탭 '적용')**, **② 런치 패널**, **③ 프로파일**뿐입니다. `auto_on_boot:false`면 부팅 시 어떤 프로세스도 자동 기동하지 않습니다(`/api/admin/status`의 `startup_pending`으로 확인 가능).

### 2. 프론트엔드 (Next.js 14, 정적 export)
```bash
cd frontend
npm install
npm run build                              # → frontend/out (백엔드가 서빙). 베이스 주소 설정 불필요
```
빌드 후 백엔드가 `frontend/out`을 **같은 오리진**에서 서빙 → 브라우저에서 `http://<서버IP>:<포트>/` (예: `http://192.168.34.202:8080`)로 접속하면 끝. **배포/원격 접속은 이 방식만 쓰면 됩니다** — 베이스 주소·CORS 문제가 원천적으로 없습니다.

**개발 서버(`npm run dev`, :3000)는 프론트 코드 수정 시에만:**
```bash
# 브라우저와 백엔드가 같은 PC일 때:
NEXT_PUBLIC_API_BASE=http://localhost:8080 npm run dev      # :3000
# 다른 PC(노트북 등)에서 dev 서버에 접속할 때는 localhost 대신 서버 LAN IP:
NEXT_PUBLIC_API_BASE=http://192.168.34.202:8080 npm run dev # :3000
```
> ⚠ `NEXT_PUBLIC_API_BASE`는 **브라우저 안에서 해석**됩니다. `localhost`로 두면 *접속한 브라우저의* localhost를 가리키므로, 다른 PC에서 접속하면 백엔드를 못 찾아 **"플랜 로드 실패"** 등 모든 API 호출이 실패합니다. 원격 접속이면 반드시 **서버 LAN IP**를 쓰거나(②), 위의 빌드본 서빙(①)을 사용하세요.

## 설정 (`config/`)
- `testbench.yaml` — 서버/컨트롤러 머신, zenoh, liveness, 스트리밍
- `startup.json` — 시작 플랜(런타임, gitignore). 관리자 탭에서 편집
- `profiles/*.yaml` — 런치 묶음(`_autostart` 등)
- `subsystems/*.yaml` — 서브시스템 manifest (`mobile_base`), `subsystems/README.md` 참고
- `snapshots/` — 워크스페이스 구성 스냅샷(런타임, gitignore)

## 머신 토폴로지
- **서버=PC1 `192.168.34.202`** — 웹툴 배포처, URDF/센서/내비/전장부/zenoh
- **컨트롤러=PC2 `192.168.34.201`** — 모터/제어, SSH 런치 전용(`~/colcon_ws`)

## 문서
- [`DESIGN.md`](DESIGN.md) — 최상위 SSOT
- `docs/` — tool-recommendation / hardware-test-mapping / main-page-wireframes / measured-interfaces
