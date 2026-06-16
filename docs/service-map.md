# 서비스 안내 (Service Map)

> `ros2 service list` 기준 (**2026-06-16**) — 로봇에 **명령을 보내 무언가를 시키는** 서비스(service) 중 의미 있는 것만 정리한 표입니다.
> 테스트벤치의 **`명령` 패널(service 모드)** 에서 호출할 수 있습니다.

## 표 읽는 법

- **★** = 이 로봇 고유 노드 기반 **추정**. 정확한 의미는 **개발자 확인 필요**.
- 아래는 **기능을 수행하는 서비스만** 추렸습니다. 모든 노드에 공통으로 달리는 **표준 인프라 서비스는 제외**했습니다:
  `describe_parameters` · `get_parameters` · `set_parameters` · `set_parameters_atomically` · `list_parameters` · `get_parameter_types` · `get_type_description` · `get_logger_levels` · `set_logger_levels` · `change_state` · `get_state` · `get_available_states` · `get_available_transitions` · `get_transition_graph`
- ⚠️ 이 문서는 **약간 고급(개발·정비용)** 입니다. 일반 관찰·조종은 [`USER_GUIDE.md`](USER_GUIDE.md), 데이터 보기는 [`topic-map.md`](topic-map.md)를 보세요.

---

## 1. 모터·구동 (스워브 드라이브)

> 이 목록으로 구동계가 드러납니다: **조향 = moteus, 구동 = VESC / ZLAC(ZLTech)**, GPIO = 라즈베리파이.

| 서비스 | 의미 |
|---|---|
| `/steering_moteus/clear_fault` | **조향 모터(moteus)** 결함(fault) 해제 ★ |
| `/vesc/clear_fault` | **구동 모터 컨트롤러(VESC)** 결함 해제 ★ |
| `/controller_manager/switch_controller` | 제어기 **활성/비활성 전환** (← 컨트롤러 패널이 이걸 사용) |
| `/controller_manager/list_controllers` | 현재 제어기 목록·상태 조회 |
| `/controller_manager/load_controller` · `/unload_controller` | 제어기 적재/해제 |
| `/controller_manager/configure_controller` · `/cleanup_controller` | 제어기 구성/정리 |
| `/controller_manager/list_hardware_components` · `/list_hardware_interfaces` | 하드웨어 구성·인터페이스 조회 |
| `/controller_manager/set_hardware_component_state` | 하드웨어 구성요소 상태 설정 |

> 참고 노드(파라미터만 노출): `/diagonal_wheels_zlac`(대각 바퀴 ZLAC 모터 ★) · `/zltech_ros2_control_diagnostics`(ZLTech 모터 진단 ★) · `/swerve_controller` · `/joint_state_broadcaster` · `/rpi_gpio`(라즈베리파이 GPIO ★) · `/w_imu_node`(IMU).

## 2. 카메라 제어 (6대 공통 — Orbbec류 SDK)

카메라 6대(`bottom_view_left/middle/rear/right`, `front_view_middle`, `handeye_view`)가 **모두 동일한 서비스 세트**를 가집니다. 아래는 한 대 기준이며, 카메라 접두어만 바꾸면 됩니다.

### 자주 쓰는 것

| 서비스 | 의미 |
|---|---|
| `.../toggle_color` · `.../toggle_depth` | **컬러/깊이 스트림 켜고 끄기** |
| `.../get_streams_enable` · `.../set_streams_enable` | 스트림 활성 상태 조회/설정 |
| `.../switch_ir` | **적외선(IR) 스트림 전환** |
| `.../reboot_device` | **카메라 재부팅** |
| `.../get_device_info` · `.../get_sdk_version` | 장치 정보·SDK 버전 조회 |
| `.../save_images` · `.../save_point_cloud` | **현재 영상/포인트클라우드 저장** |
| `.../send_software_trigger` | 소프트웨어 트리거(촬영 신호) |

### 화질·노출 조정

| 서비스 | 의미 |
|---|---|
| `.../get_color_exposure` · `.../set_color_exposure` | 컬러 **노출** 조회/설정 |
| `.../set_color_auto_exposure` | 컬러 **자동 노출** on/off |
| `.../get_color_gain` · `.../set_color_gain` | 컬러 **게인(감도)** |
| `.../get_depth_exposure` · `.../set_depth_exposure` | 깊이 노출 |
| `.../set_depth_auto_exposure` | 깊이 자동 노출 |
| `.../get_depth_gain` · `.../set_depth_gain` | 깊이 게인 |
| `.../get_auto_white_balance` · `.../set_auto_white_balance` | 자동 화이트밸런스 |
| `.../get_white_balance` · `.../set_white_balance` | 화이트밸런스 값 |
| `.../set_ae_strategy` · `.../set_ae_reference_stream` | 자동노출(AE) 전략·기준 스트림 |
| `.../set_color_ae_roi` · `.../set_depth_ae_roi` | 자동노출 관심영역(ROI) |
| `.../set_ir_long_exposure` | IR 장노출 |

### 영상 방향·필터·기타

| 서비스 | 의미 |
|---|---|
| `.../set_color_flip` · `.../set_color_mirror` · `.../set_color_rotation` | 컬러 영상 **상하반전/좌우반전/회전** |
| `.../set_depth_flip` · `.../set_depth_mirror` · `.../set_depth_rotation` | 깊이 영상 반전/회전 |
| `.../set_filter` | 깊이 **필터** 설정 |
| `.../set_floor_enable` | 바닥 제거 기능 on/off ★ |
| `.../set_disparity_range_mode` · `.../set_disparity_search_offset` | 시차(disparity) 범위·오프셋 |
| `.../get_point_cloud_decimation` · `.../set_point_cloud_decimation` | 포인트클라우드 **다운샘플링** |
| `.../set_fan_work_mode` | 카메라 **팬(냉각) 동작 모드** |

### 안전·동기화

| 서비스 | 의미 |
|---|---|
| `.../get_laser_status` · `.../set_laser_enable` | **레이저 프로젝터** 상태/on·off |
| `.../get_ldp_status` · `.../set_ldp_enable` | **LDP(레이저 안전 보호)** 상태/on·off ★ |
| `.../get_lrm_measure_distance` | 거리 측정값 조회 ★ |
| `.../get_ptp_config` · `.../set_ptp_config` | **PTP 시각 동기화** 설정 |
| `.../set_sync_hosttime` · `.../set_reset_timestamp` | 호스트 시간 동기화·타임스탬프 리셋 |
| `.../set_sync_interleaverlaser` | 레이저 인터리브 동기화 ★ |

> 참고: 각 카메라에는 `.../camera_container/get_type_description` 컨테이너 노드도 존재(내부용).

## 3. 전원·하드웨어 허브

| 서비스 | 의미 |
|---|---|
| `/daly_bms_node/set_battery_output` | **배터리 출력 on/off** (DALY BMS) ★ |
| `/exsys_hub_node/set_port` | **USB 허브 특정 포트 전원** on/off ★ |
| `/exsys_hub_node/reset` · `/factory_reset` · `/save` | 허브 리셋·공장초기화·설정 저장 ★ |
| `/usb_camera_monitor/rescan` | **USB 카메라 재검색** |

## 4. 자율주행 제어 (Nav2)

| 서비스 | 의미 |
|---|---|
| `/global_costmap/clear_entirely_global_costmap` | **전역 비용지도 전체 비우기** (잘못 쌓인 장애물 초기화) |
| `/local_costmap/clear_entirely_local_costmap` | **지역 비용지도 전체 비우기** |
| `/global_costmap/clear_around_global_costmap` · `/local_costmap/clear_around_local_costmap` | 로봇 주변만 비우기 |
| `/global_costmap/clear_except_global_costmap` · `/local_costmap/clear_except_local_costmap` | 지정 영역만 남기고 비우기 |
| `/global_costmap/get_costmap` · `/local_costmap/get_costmap` | 현재 비용지도 조회 |
| `/collision_monitor/toggle` | **충돌 감시 켜고 끄기** |
| `/map_server/load_map` · `/map_server/map` | **지도 불러오기**/지도 조회 |
| `/lifecycle_manager_navigation/manage_nodes` | **내비게이션 노드 묶음** 시작/정지/재시작 |
| `/lifecycle_manager_localization/manage_nodes` | **위치추정 노드 묶음** 관리 |
| `/lifecycle_manager_collision_monitor/manage_nodes` | **충돌감시 노드 묶음** 관리 |
| `/lifecycle_manager_*/is_active` | 각 묶음 활성 여부 조회 |

## 5. 위치 추정 (emcl2)

> 위치 추정은 표준 AMCL이 아닌 **emcl2** 를 사용합니다.

| 서비스 | 의미 |
|---|---|
| `/global_localization` | **전역 위치 재추정** (로봇이 위치를 완전히 잃었을 때) |
| `/emcl_reinit` | 위치 추정 **재초기화** ★ |
| `/emcl_force_reset` | 위치 추정 **강제 리셋** ★ |
| `/fromLL` | **위경도(GPS) → 지도 좌표** 변환 |

## 6. 행동 트리(BT) 실행

| 서비스 | 의미 |
|---|---|
| `/get_loaded_trees` | 적재된 **행동 트리 목록** 조회 ★ |

> `/bt_execution_server` 는 별도 BT 실행 서버(파라미터만 노출). 메모리상 202의 `bt_execution_gui`와 연관 가능성 — 개발자 확인 필요.

## 7. 시스템 모니터 (파라미터만 노출 — 기능 서비스 없음)

`/kernel_log_monitor` · `/link_latency_gateway` · `/link_latency_internet` · `/router_throughput_monitor` · `/wifi_wan_monitor` 는 데이터를 토픽으로 내보내며([`topic-map.md`](topic-map.md) §7), 별도 호출 서비스는 없습니다.

---

> _이 문서 버전: 초안 v0.1 — 2026-06-16. ★ 표시 항목 의미는 개발자 확인 후 확정 권장._
