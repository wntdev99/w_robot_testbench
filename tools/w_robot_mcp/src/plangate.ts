/**
 * 계획 토큰 게이트 — 모션 도구의 "계획→승인→실행" 강제.
 * 흐름: confirm 없이 호출 → 계획 + 1회용 token 발급(파라미터에 고정).
 *       실행은 confirm=true + 그 token + 동일 파라미터일 때만 통과(소비됨).
 * 파라미터가 바뀌면 token이 무효 → 반드시 다시 계획을 거친다(사용자에게 새 계획 노출).
 */
let pending: { token: string; key: string; ts: number } | null = null;
const TTL_MS = 120_000;

function rnd(): string {
  // MCP(Node) 런타임에선 Math.random 사용 가능(워크플로 샌드박스 아님)
  return Math.random().toString(36).slice(2, 8) + Math.random().toString(36).slice(2, 6);
}

export const planGate = {
  /** 계획 단계: 파라미터 키에 묶인 1회용 토큰 발급. */
  issue(key: string): string {
    pending = { token: rnd(), key, ts: Date.now() };
    return pending.token;
  },
  /** 실행 단계: 토큰·파라미터 일치 + 미만료면 통과(소비). 아니면 사유 문자열 반환. */
  check(key: string, token: string | undefined): string | null {
    if (!token) return "승인 토큰이 없습니다(계획 단계 미경유)";
    if (!pending) return "사전 계획이 없습니다";
    if (Date.now() - pending.ts > TTL_MS) {
      pending = null;
      return "계획이 만료됨(2분 경과)";
    }
    if (pending.token !== token) return "토큰 불일치";
    if (pending.key !== key) return "계획과 파라미터가 다름(수정됨)";
    pending = null; // 1회용 — 소비
    return null;
  },
};
