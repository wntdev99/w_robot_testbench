# 토픽 안내 (Topic Map)

> `ros2 topic list` 기준 (**2026-06-16**) — 로봇이 주고받는 데이터(토픽)가 각각 무엇을 뜻하는지 사람 말로 정리한 표입니다.
> 플롯·카메라·메시지 패널에서 **어떤 토픽을 골라야 하는지** 찾을 때 사용하세요.

## 표 읽는 법

- 아래는 **의미 있는 토픽만** 추렸습니다. 내부·부수 토픽(`*/transition_event`, `*_raw_updates`, `/bond`, `/tf`, `/tf_static`, `/parameter_events`, `/rosout`, `camera_info`, `metadata`, `theora`, `introspection_data`, `statistics`, `robot_description` 등)은 일반 사용 시 무시해도 됩니다.

---

## 1. 이동·주행 (스워브 모바일베이스)

| 토픽 | 의미 |
|---|---|
| `/swerve_controller/cmd_vel` | 스워브 주행 제어기에 들어가는 **속도 명령**(전후·좌우·회전) |
| `/swerve_controller/cmd_vel_limited` | 안전 한계로 제한된 실제 적용 속도 명령 |
| `/cmd_vel_smoothed` | 급가감속을 부드럽게 다듬은 속도 명령 |
| `/swerve_controller/odom` | 바퀴 기반 **주행거리계(오도메트리)** |
| `/fused_odom` | 여러 센서를 융합한 **주행거리계** |
| `/swerve_controller/controller_state` | 스워브 제어기 내부 상태(각 바퀴 조향·구동) |
| `/joint_states` | **모든 관절(바퀴·조향)의 현재 위치·속도** |
| `/dynamic_joint_states` | 관절 상태(동적, 인터페이스별 상세) |
| `/speed_limit` | 현재 적용 중인 속도 제한값 |

## 2. 거리·자세 센서

| 토픽 | 의미 |
|---|---|
| `/scan` | **2D 라이다** 거리 스캔 (장애물 감지의 핵심) |
| `/imu` | **관성센서(IMU)** — 기울기·회전·가속도 |

## 3. 카메라 (6대 — RealSense류, 컬러+깊이)

카메라마다 같은 패턴의 토픽이 반복됩니다.

### 카메라 위치

| 카메라(접두어) | 용도 추정 |
|---|---|
| `/bottom_view_left_camera` | 바닥 감시 — 좌측 |
| `/bottom_view_middle_camera` | 바닥 감시 — 중앙 |
| `/bottom_view_rear_camera` | 바닥 감시 — 후방 |
| `/bottom_view_right_camera` | 바닥 감시 — 우측 |
| `/front_view_middle_camera` | 전방 주시 |
| `/handeye_view_camera` | **로봇 팔 끝(핸드아이)** 카메라 |

### 카메라마다 실제로 볼 토픽

| 토픽 패턴 | 의미 |
|---|---|
| `.../color/image_raw` | **컬러 영상** ← 카메라 패널에서 이걸 고름 |
| `.../color/image_raw/compressed` | 컬러 영상(압축) — 네트워크 절약용 |
| `.../depth/image_raw` | **깊이(거리) 영상** |
| `.../device_status` | 카메라 장치 **정상 여부** |
| `.../color/image_raw/compressed/hz` | 컬러 영상 수신 **주파수(Hz)** — 끊김 점검용 |
| `.../depth/image_raw/hz` | 깊이 영상 수신 주파수(Hz) |

> 💡 `/hz` 토픽은 카메라가 아니라 **테스트벤치가 영상 수신 빈도를 직접 측정해 내보내는 값**(`std_msgs/Float32`)입니다. 플롯 패널에서 숫자로 보며 영상 끊김·지연을 점검할 때 씁니다.

### 카메라별 수신 주파수(Hz) 토픽 — 전체 목록

| 카메라(위치) | 컬러 영상 Hz | 깊이 영상 Hz |
|---|---|---|
| 바닥 — 좌측 | `/bottom_view_left_camera/color/image_raw/compressed/hz` | `/bottom_view_left_camera/depth/image_raw/hz` |
| 바닥 — 중앙 | `/bottom_view_middle_camera/color/image_raw/compressed/hz` | `/bottom_view_middle_camera/depth/image_raw/hz` |
| 바닥 — 후방 | `/bottom_view_rear_camera/color/image_raw/compressed/hz` | `/bottom_view_rear_camera/depth/image_raw/hz` |
| 바닥 — 우측 | `/bottom_view_right_camera/color/image_raw/compressed/hz` | `/bottom_view_right_camera/depth/image_raw/hz` |
| 전방 — 중앙 | `/front_view_middle_camera/color/image_raw/compressed/hz` | `/front_view_middle_camera/depth/image_raw/hz` |
| 핸드아이 | `/handeye_view_camera/color/image_raw/compressed/hz` | `/handeye_view_camera/depth/image_raw/hz` |

## 4. 자율주행 (Nav2)

| 토픽 | 의미 |
|---|---|
| `/map` | **점유 격자 지도** ← 네비게이션 패널 배경 |
| `/global_costmap/costmap` | **전역 비용지도** (전체 경로 계획용 장애물 지도) |
| `/local_costmap/costmap` | **지역 비용지도** (주변 회피용) |
| `/global_costmap/footprint` · `/published_footprint` | 지도 위 **로봇 외형(발자국)** |
| `/mcl_pose` | **추정된 로봇 위치**(AMCL) |
| `/particlecloud` · `/particle_weight` | 위치 추정 파티클 분포·가중치 |
| `/initialpose` | (사용자가 찍는) **초기 위치 = `2D Pose Estimate`** |
| `/goal_pose` | (사용자가 찍는) **목표 지점 = `Nav Goal`** |
| `/plan` · `/plan_smoothed` | 계획된 **전역 주행 경로** |
| `/unsmoothed_plan` · `/transformed_global_plan` | 다듬기 전·변환된 경로 |
| `/optimal_trajectory` · `/trajectories` | 지역 경로 후보·최적 궤적 |
| `/collision_monitor/collision_points_marker` | **충돌 감시** 위험 지점 표시 |
| `/collision_monitor_state` | 충돌 감시 현재 상태 |

## 5. 작업 장치 (컨베이어·문·GPIO)

| 토픽 | 의미 |
|---|---|
| `/conveyor_position_controller/commands` | **컨베이어** 위치 명령 |
| `/conveyor_velocity_controller/commands` | **컨베이어** 속도 명령 |
| `/conveyor_ired_broadcaster/values` · `/names` | 컨베이어 **적외선 센서(iRED)** 값·이름 |
| `/door_s1_controller/command` · `/status` | **옆문(side door) 개폐** 명령·상태 |
| `/gpio_controller/gpio_states` | **디지털 입출력(GPIO)** 현재 상태 |
| `/gpio_controller/commands` | GPIO 출력 명령 |

## 6. 전원·전장 모니터

| 토픽 | 의미 |
|---|---|
| `/daly_bms_node/status` | **배터리(DALY BMS)** 상태 — 전압·전류·잔량(SOC)·온도 |
| `/daly_bms_node/fault` | 배터리 **결함/경고** |
| `/exsys_hub_node/hub_status` | **USB 허브** 상태 — 각 포트 전원 on/off 제어 허브 |
| `/usb_camera_monitor/devices` | 연결된 **USB 카메라 장치** 목록 |

## 7. 네트워크·시스템 모니터

| 토픽 | 의미 |
|---|---|
| `/link_latency_gateway/latency` · `/outage` | **게이트웨이 지연·끊김** |
| `/link_latency_internet/latency` · `/outage` | **인터넷 지연·끊김** |
| `/wifi_wan_monitor/wifi_wan` | **Wi-Fi/WAN 회선** 상태 |
| `/router_throughput_monitor/br_lan` | 라우터 **처리량 — LAN** |
| `/router_throughput_monitor/sta1` | 라우터 **처리량 — 무선 단말(STA)** |
| `/kernel_log_monitor/kernel_log` | **커널 로그** 감시 |
| `/diagnostics` | **통합 자가진단**(모터 온도·전류 등) → Diagnostics 패널 |

---

> _이 문서 버전: v1.0 — 2026-06-16. 커스텀 토픽 의미 개발자 확인 완료._
