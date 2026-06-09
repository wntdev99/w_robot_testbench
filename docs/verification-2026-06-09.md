# 아키텍처 가정 검증 기록 (2026-06-09)

> DESIGN v0.3의 **4대 구조 가정 + 보조 2개**를 실제 로봇에서 검증한 기록.
> 재현 스크립트: [`scripts/verify_assumptions.sh`](../scripts/verify_assumptions.sh).
> **원칙**: 토픽/노드 카탈로그는 *런타임 동적 발견* 대상이므로 박제하지 않는다(미완성 로봇 → 곧 변함). 본 문서는 **판정 + 곧 안 바뀔 구조적 인터페이스**만 기록한다.
>
> 측정 시점 가동 상태: 202 = zenoh 라우터 + `robot.launch.py` + `navigation.launch.py use_velocity_smoother:=false ekf_enable:=false`(cmd_vel 확인용 임시) / 201 = `control.launch.py ekf_enable:=true`.

## 판정 요약 (4+2 전부 합격)
| 검증 | 판정 | 근거 |
|---|:--:|---|
| 1. zenoh 단일 라우터 + 디스커버리 | ✅ | 202 node list에 201 노드(`controller_manager`·`swerve_controller`·`steering_moteus`·`joint_state_broadcaster`·`diagonal_wheels_zlac`) 가시. 201 `.bashrc`가 `mode="client"; connect tcp/192.168.34.202:7447` |
| 2. 202→201 SSH 무인 | ✅ | 키 배포 후 `HOP_202_TO_201_OK`. (당일 부트스트랩으로 해결, 아래 참조) |
| 3. ROS 프로세스 식별·정리 | ✅ | `pgrep -af`로 `rmw_zenohd`·`ros2 launch`·자식 노드 cmdline 전부 식별. 부모 launch→자식 프로세스 트리 추적 근거 확보 |
| 4. 타입 introspection | ✅ | `ros2 interface show`가 타입→필드 트리(Twist: linear/angular×xyz) 추출. rclpy/rosidl 동일 가능 → 동적폼 근간 OK |
| A. cmd_vel 타입 | ✅ | `geometry_msgs/msg/Twist` (TwistStamped 아님) |
| B. /diagnostics 구조 | ✅ | `diagnostic_msgs/DiagnosticArray` (모터 텔레메트리 통로) |

## 핵심 인터페이스 (구조적 사실 — 박제 대상)
- **cmd_vel = `geometry_msgs/msg/Twist`**. 토픽 *경로*는 구성마다 다름(`/swerve_controller/cmd_vel`, `/cmd_vel_smoothed`, `/swerve_controller/cmd_vel_limited` 등 모두 Twist). 제어/텔레옵 위젯 폼은 Twist 기준.
- **모터 텔레메트리 = `/diagnostics`** (`DiagnosticArray`). `status[].hardware_id="can2:<N>"`, `name="steering_moteus: ...motor_N@can2"`, `values` key: `position_rad`·`velocity_radps`·`effort_Nm`·`temperature_C`·`voltage_V`·`current_A`·`fault_code`·`mode_raw` 등.
  → **plot 위젯에 diagnostics(key-value) 파서 필요** — 일반 topic plot과 별개 경로.

## SSH 무인화 (검증2 해결 절차)
- 202에 `~/.ssh/id_ed25519` 신규 생성 → 공개키를 201 `~/.ssh/authorized_keys`에 등록(개발PC 경유, **비밀번호 미사용·미저장**).
- 되돌리기: 201 authorized_keys에서 202 공개키 줄 삭제.
- **제품 서버(202 단독, 개발PC 없음)**: admin 페이지 "201 연결 설정" 부트스트랩 — 비번 1회 입력 → `ssh-copy-id` → 비번 즉시 폐기. **비번 영구 저장 금지**.

## 후속 (런타임/구현 시점에 발견)
- 충전/기타 diagnostics 출처, 카메라 파이프라인 — 미확인(해당 서브시스템 프로젝트 저작 시 introspect).
- 난입(foreign) 프로세스 트리 추적 패턴: V3 cmdline 패턴(`/opt/ros/`·`ros2_ws/install`·`rmw_zenohd`·`ros2 launch`) 확인됨 → boot_gate 구현 시 활용.
- 현재 로봇은 nav2 풀스택·emcl2·docking·behavior_tree·rplidar·imu·ekf 가동(수십 노드) → baseline/프로젝트 규모 전제.
