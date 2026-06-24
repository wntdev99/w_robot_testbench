/**
 * 정지 인터록(래치) — 설계 §15.
 * engaged 동안 모든 모션 도구가 거부된다. 명시적 reset 전까지 자동 해제 없음.
 * (단일 조작자 전제 → MCP 레벨 래치. 백엔드 무수정.)
 */
let engaged = false;
let sinceMs: number | null = null;
let reason = "";

export const latch = {
  get engaged() {
    return engaged;
  },
  get sinceMs() {
    return sinceMs;
  },
  get reason() {
    return reason;
  },
  engage(why: string) {
    engaged = true;
    sinceMs = Date.now();
    reason = why;
  },
  reset() {
    engaged = false;
    sinceMs = null;
    reason = "";
  },
};
