# w_robot_testbench

웹 기반 ROS2 로봇 테스트벤치 — **테스트 프로젝트 패러다임**.
설계 SSOT: [`DESIGN.md`](DESIGN.md) (v0.3) + [`docs/`](docs/) (부속 A~D).

브라우저로 `http://192.168.34.202:8080` 접속 → 로봇 운용/테스트.

---

## 새 머신 셋업 (자동 — 수동 pip 없음)

의존성 SSOT는 `package.xml`(rosdep). **머신마다 pip를 직접 나열하지 않는다.**

```bash
# 0) 레포를 ROS2 워크스페이스에 둔다
#    ~/ros2_ws/src/w_robot_testbench

cd ~/ros2_ws

# 1) ROS + pip 의존성 일괄 설치 (rosdep, package.xml 기반) — 이 한 줄이 핵심
rosdep install --from-paths src --ignore-src -y

# 2) 빌드 + 환경
colcon build --packages-select w_robot_testbench
source install/setup.bash

# 3) 백엔드 기동 (rclpy + FastAPI + uvicorn, http://0.0.0.0:8080)
ros2 run w_robot_testbench testbench
```

### 프론트엔드 (Next.js 14)
```bash
cd ~/ros2_ws/src/w_robot_testbench/frontend
npm ci && npm run build && npm start   # http://localhost:3000 → /api/* 는 백엔드로 프록시
```

> 배포: colcon package + systemd (DESIGN §3). 201(컨트롤러)은 SSH 런치 전용 — 웹 스택 미배포.

---

## 구조
```
DESIGN.md            # 최상위 SSOT (v0.3)
docs/                # 부속 A 도구권장 / B 52테스트 / C 와이어프레임 / D 테스트프로젝트모델 + 검증기록
package.xml          # 의존성 SSOT (rosdep, ament_python)
setup.py             # colcon ament_python
config/              # testbench.yaml, baseline.yaml, projects/, records/
backend/testbench/   # FastAPI + rclpy (main, ros_bridge, ws_manager, procman/boot_gate, api/)
frontend/            # Next.js 14 (COLCON_IGNORE — colcon 빌드 제외, npm 별도)
scripts/             # 검증 스크립트 (verify_assumptions, bootgate_test)
```
