/** 공통 헬퍼 — 도구 응답·오류 사람말 변환·트위스트. */
import { spawn } from "node:child_process";
import { ApiError, tb } from "./client.js";
import { CMD_VEL_TOPIC, CMD_VEL_TYPE } from "./config.js";

/** OS 기본 앱으로 URL/파일 열기 (mac/win/linux). */
export function osOpen(target: string) {
  if (process.platform === "darwin") spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
  else if (process.platform === "win32")
    spawn("cmd", ["/c", "start", "", target], { detached: true, stdio: "ignore" }).unref();
  else spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
}

export const ok = (text: string) => ({ content: [{ type: "text" as const, text }] });
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 백엔드 호스트(서버 IP) — SSH 안내용. */
function backendHost(): string {
  try {
    return new URL(tb.base).hostname;
  } catch {
    return "192.168.34.202";
  }
}

/** 백엔드 수동 기동 안내문(연결 실패 시 그대로 보여줌). */
export function backendStartGuide(): string {
  const host = backendHost();
  return [
    "백엔드(테스트벤치 서버)가 꺼져 있을 수 있어요. 새 터미널에서 켜세요:",
    `  1) ssh james@${host}        (비밀번호 입력)`,
    "  2) cd ~/ros2_ws/src/w_robot_testbench",
    "  3) ./scripts/run_server.sh",
    `  → "0.0.0.0:8080" 뜨면 성공. 그 터미널은 그대로 두세요(끄면 서버도 꺼짐).`,
  ].join("\n");
}

/** ApiError를 비개발자용 사람 말 + 다음 행동으로 (설계 §11.4). */
export function humanizeError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 0)
      return `로봇 서버에 연결이 안 돼요 (${tb.base}). 같은 Wi-Fi인지 확인하세요.\n${backendStartGuide()}`;
    if (e.status === 404)
      return "아직 그 기능(토픽/서비스)이 안 켜진 것 같아요. 필요한 런치를 먼저 켜 보세요.";
    if (e.status === 503)
      return "컨트롤러가 아직 안 떴어요. 로봇 기동(컨트롤러)을 먼저 해 주세요.";
    if (e.status === 429) return "동시에 너무 많이 켰어요(예: 카메라). 잠시 후 다시.";
    return `요청이 거부됐어요: ${e.detail}`;
  }
  return `예상치 못한 오류: ${e instanceof Error ? e.message : String(e)}`;
}

export function zeroTwist() {
  return { linear: { x: 0, y: 0, z: 0 }, angular: { x: 0, y: 0, z: 0 } };
}
export function twist(vx: number, vy: number, omega: number) {
  return { linear: { x: vx, y: vy, z: 0 }, angular: { x: 0, y: 0, z: omega } };
}
export async function publishCmdVel(data: object) {
  await tb.post("/api/publish", { topic: CMD_VEL_TOPIC, type: CMD_VEL_TYPE, data });
}

/** yaw(rad) → 쿼터니언(z,w). */
export function yawToQuat(yaw: number) {
  return { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
}

/** swerve_controller가 active 인가? 확인 불가(네트워크 등)면 보수적으로 false(=주행 금지/중단). */
export async function swerveActive(): Promise<boolean> {
  try {
    const cs = await tb.get<Array<{ name: string; state: string }>>("/api/controllers", 2000);
    return cs.find((c) => c.name === "swerve_controller")?.state === "active";
  } catch {
    return false;
  }
}
