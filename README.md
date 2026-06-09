# w_robot_testbench

웹 기반 ROS2 로봇 테스트벤치 (FastAPI + rclpy / Next.js 14). 설계 SSOT: [`DESIGN.md`](DESIGN.md).

브라우저로 `http://<서버IP>:<포트>` 접속 → 시스템 상태·런치 오케스트레이션·텔레옵·모터/제어·측정 플롯을 Toss풍 UX로.

## 구현 현황 (P0/P1 완료, 라이브 검증됨)
- 백엔드: FastAPI + rclpy 브리지(introspect/subscribe/publish/service), `/diagnostics` 파서(모터 온도/전류/토크), WS 스트림, 시스템 모니터(psutil/온도/네트워크/인터넷), zenoh 상태, 프로세스 오케스트레이션(로컬+201 SSH+autostart, exclusive 프로파일), 전역 E-stop
- 프론트: 사이드바 + 전역 상태바 + E-stop 바 + 대시보드 / 시스템 / 런치 / 텔레옵 / 모터·제어 / 측정·플롯(uPlot) / 명령
- 미구현(차기): publish/service 동적 폼(P2), 서브시스템 manifest UI, 테스트 카탈로그·런 엔진(P3), 전장부/카메라(P4/P5)

## 실행

### 1. 백엔드 (서버 머신=202 또는 개발 PC, ROS2 Jazzy 소싱 상태)
```bash
# 의존성 (202 에는 fastapi/uvicorn/asyncssh 미설치 → 최초 1회)
pip install fastapi "uvicorn[standard]" pyyaml psutil asyncssh pydantic

cd backend
python3 -m testbench.main            # config/testbench.yaml 의 host:port (기본 0.0.0.0:8080)
# 개발 중 임의 포트: python3 -m testbench.main --port 8099
```
- 자동 순차기동(zenoh→robot_urdf→201 controller)은 **모터 전원 인가를 수반**하므로 기본 비활성.
  의도적으로 켤 때만 `TESTBENCH_AUTOSTART=1 python3 -m testbench.main`.

### 2. 프론트엔드
```bash
cd frontend
npm install
# (A) 프로덕션: 정적 빌드 → 백엔드가 frontend/out 서빙 → http://<서버>:<포트>/
npm run build
# (B) 개발: 별도 dev 서버(:3000), 백엔드 API 가리키기
NEXT_PUBLIC_API_BASE=http://localhost:8099 npm run dev
```

## 문서
- `DESIGN.md` — 최상위 SSOT
- `docs/tool-recommendation.md` / `hardware-test-mapping.md` / `main-page-wireframes.md` / `measured-interfaces.md`
- `config/subsystems/README.md` — 서브시스템 manifest 확장 가이드

## 머신 토폴로지
- 서버=PC1 `192.168.34.202` (웹툴 배포처) · 컨트롤러=PC2 `192.168.34.201` (SSH 런치 전용, `~/colcon_ws`)
