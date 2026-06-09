# 실측 인터페이스 인벤토리 — 현재 존재하는 것 (모바일 베이스)

> 2026-06-09 SSH 정적 실측(소스/config/interface 정의 기반, **모터 비에너자이즈**).
> 현재 로봇은 **모바일 베이스만 존재** — 도어/카메라/암/컨베이어 등은 아직 없음(추후 manifest 추가).
> 표의 ⚠는 **로봇 라이브 기동 후 런타임 확인 필요**(remap/정확 토픽명/QoS). 나머지는 소스/config로 확정.

---

## 1. 존재하는 패키지 (201 `~/colcon_ws/src`)

| 패키지 | 역할 |
|---|---|
| `w_ros2_controllers/w_swerve_controller` | 스워브 컨트롤러 (`w_swerve_controller/WSwerveController`) |
| `moteus_api` (`w_moteus_hw`) | 조향 4모터 (moteus) ros2_control 하드웨어 + **diagnostics 발행** |
| `zltech_ros2_driver` | 구동 휠 (ZLAC8015D) ros2_control 하드웨어 + **diagnostics/통계 발행** |
| `w_ros2_can_core` | CAN 코어 |
| `w_imu` | IMU 노드 |
| `rplidar_ros` / `scan_deskew` | RPLiDAR S3 + 스캔 보정 |
| `w_type_mm` | 브링업(robot/control/nav/localization/ekf) |

> 전장부(`daly_bms_interfaces`/`elyx_rx_interfaces`/`wireless_charging_interfaces`)는 **현재 워크스페이스 overlay에 빌드 안 됨**(`ros2 interface packages`에 미노출). CAN(`can_bms`/`can_chg`)은 202에 UP이나 ROS 계층 비활성 → **"존재하지만 아직 미배포"**로 간주, 빌드/기동 시 manifest로 편입.

---

## 2. 모바일 베이스 ROS 인터페이스 (실측)

### 2.1 명령 / 상태 토픽
| 용도 | 토픽 | 타입 | 근거 |
|---|---|---|---|
| 주행 명령 | `/swerve_controller/cmd_vel` | `geometry_msgs/Twist` | control.launch 독스트링 `ros2 topic pub ... geometry_msgs/Twist` |
| 조인트 상태 | `/joint_states` | `sensor_msgs/JointState` | joint_state_broadcaster (pos/vel/effort) |
| 오도메트리 | `/swerve_controller/odom` | `nav_msgs/Odometry` | swerve_controllers.yaml `odom_frame_id`, `enable_odom_tf:false` |
| **모터 진단** | `/diagnostics` | `diagnostic_msgs/DiagnosticArray` | moteus+zltech 둘 다 발행(§2.3) |
| IMU | `/imu` ⚠ | `sensor_msgs/Imu` | ekf 주석 "/imu + odom → /fused_odom" |
| LiDAR | `/scan` ⚠ | `sensor_msgs/LaserScan` | rplidar_s3.launch |
| EKF 융합 | `/fused_odom` (옵션) | `nav_msgs/Odometry` | `ekf_enable` 기본 false (nav에서 켬) |
| URDF | `/robot_description` | latched String | robot.launch (RSP) |

### 2.2 조향 모터 매핑 (moteus.yaml — 확정)
| joint | moteus_id | 위치 | CAN |
|---|---|---|---|
| steering_LH | 11 | FL 전좌 | can2 |
| steering_RH | 12 | FR 전우 | can2 |
| steering_LT | 13 | RL 후좌 | can2 |
| steering_RT | 14 | RR 후우 | can2 |
구동 휠(ZLAC): `wheel_LH`(FL), `wheel_RT`(RR) 구동 / FR·RL 비구동(자유회전). 공통: gear_ratio 1.0, velocity_max 6.28rad/s, effort_max 40Nm.

### 2.3 ★ 모터 텔레메트리 = `/diagnostics` (역량 C·F·J 핵심)
**moteus 조향모터** (`moteus_api/.../diagnostics_publisher.cpp`): per-motor `DiagnosticStatus`,
`hardware_id = "<can_iface>:<moteus_id>"` (예: `can2:11`). values 키:
```
position_rad, velocity_radps, effort_Nm, temperature_C, voltage_V,
current_A, fault_code, mode_raw, saturated_{position,velocity,effort}, last_response_age_ms
```
**ZLAC 구동휠** (`zltech_ros2_driver/.../zltech_system_interface.cpp:382`): `/diagnostics` 발행 +
`statistics_aggregator`(atomic 카운터 → **CAN 끊김/통계 카운트** = 역량 J). DD-7: Jazzy에 `control_msgs/HardwareStatus` 없어 `DiagnosticArray`로 대체.

→ **테스트 4(조향토크)= effort_Nm/current_A, 31(모터온도)= temperature_C, 39(CAN 끊김)= zltech 카운터** 전부 `/diagnostics` 파싱으로 해결.

### 2.4 컨트롤러 매니저 (역량 B)
표준 `controller_manager_msgs/srv`: `/controller_manager/list_controllers`, `/switch_controller`, `/configure_controller` 등. 컨트롤러: `joint_state_broadcaster`, `swerve_controller`. → "특정 컨트롤러만 활성화" = `switch_controller`. 직접 모터제어(0점/토크)는 swerve_controller 외 별도 컨트롤러/모드 필요 ⚠(라이브 확인).

---

## 3. 현재 매핑 가능한 역량 (vs 부속 B 12역량)

| 역량 | 현 모바일 베이스로 가능? | 채널 |
|---|---|---|
| A 텔레옵 | ✅ | teleop_joy+twist_mux → /swerve_controller/cmd_vel |
| B 모터 직접제어 | △ 부분 | controller switch 가능, 0점/토크 직접명령은 컨트롤러 모드 확인 필요 ⚠ |
| C 모터 텔레메트리 | ✅ | /diagnostics (temperature_C/current_A/effort_Nm) |
| F 센서 모니터 | △ | 모터 fault/온도는 diagnostics, 물리스위치류는 없음(도어 등 부재) |
| J CAN 진단 | ✅ | zltech statistics_aggregator 카운터 |
| 기타(D 도어·H 카메라·I 도킹·G 충전 등) | ❌ 현재 없음 | 추후 패키지 추가 시 manifest 편입 |

---

## 4. 라이브 확인 잔여 항목 (로봇 기동 후) ⚠
1. `/imu`·`/scan` 정확 토픽명·QoS, cmd_vel이 Twist vs TwistStamped 최종 확인
2. `/diagnostics` 의 DiagnosticStatus `name` 필드 규약(예: "steering_LH" vs "can2:11") — 플롯 셀렉터 키
3. swerve_controller 외 **직접 모터제어/0점/토크 모드** 노출 인터페이스(역량 B)
4. ZLAC `statistics_aggregator` 가 노출하는 정확한 카운터 키(역량 J)
5. 전장부(BMS/충전) 빌드·기동 시 토픽/타입

> 위 1·2·4는 모터 에너자이즈 없이 **zenoh + control.launch.py 기동만으로** 확인 가능하나, 모터 전원 인가가 수반되므로 **별도 승인 후** 진행.

---

## 5. 확장 구조 (추후 도어/카메라/암 추가)
신규 서브시스템은 **코드 수정 없이** `config/subsystems/<id>.yaml` + `config/profiles/<id>.yaml`(+ 필요시 `config/tests/*.yaml`) 추가만으로 편입된다. 현재는 `config/subsystems/mobile_base.yaml` 하나만 실측 기반으로 작성(부속: 해당 파일). 백엔드 `manifest_loader`가 디렉토리를 스캔해 자동 등록 → UI에 카드/페이지 동적 생성.
