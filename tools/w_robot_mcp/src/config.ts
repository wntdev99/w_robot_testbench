/** 공통 상수/플래그. */
export const CMD_VEL_TOPIC = "/swerve_controller/cmd_vel";
export const CMD_VEL_TYPE = "geometry_msgs/msg/Twist";
export const SOFT_CAP_LINEAR = 0.3; // m/s 초과 시 추가 경고
export const SOFT_CAP_ANGULAR = 0.5; // rad/s 초과 시 추가 경고
export const HEARTBEAT_MS = 100; // 10Hz (컨트롤러 0.5s 타임아웃보다 빠르게)
export const MAX_DURATION_S = 30; // 블로킹 drive(짧은 점검 버스트) 상한
export const SAFETY_CHECK_EVERY = 5; // 하트비트 5회(=0.5s)마다 컨트롤러 활성 재확인
export const MAX_BACKGROUND_S = 180; // 백그라운드 연속주행(start_drive) 백스톱 — 잊어도 N초 후 자동정지
export const RING_SECONDS = 30; // 링버퍼 보관 시간

/** 기동 시 자동 구독할 기본 텔레메트리(설계 §3). */
export const DEFAULT_SUBS: Array<{ topic: string; type: string }> = [
  { topic: "/joint_states", type: "sensor_msgs/msg/JointState" },
  { topic: "/swerve_controller/odom", type: "nav_msgs/msg/Odometry" },
  { topic: "/imu", type: "sensor_msgs/msg/Imu" },
];

/** 파괴적 동작(시작플랜 적용 / 일괄 kill) 허용 여부 — 기본 비활성. */
export const ALLOW_DESTRUCTIVE = process.env.MCP_ALLOW_DESTRUCTIVE === "1";
