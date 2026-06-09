// API/WS 베이스. 개발: NEXT_PUBLIC_API_BASE=http://localhost:8099.
// 프로덕션(FastAPI 정적 서빙): 동일 오리진.
export function apiBase(): string {
  const env = process.env.NEXT_PUBLIC_API_BASE;
  if (env) return env.replace(/\/$/, "");
  if (typeof window !== "undefined") return window.location.origin;
  return "";
}

export function wsUrl(): string {
  const base = apiBase();
  if (base.startsWith("https")) return base.replace(/^https/, "wss") + "/ws";
  if (base.startsWith("http")) return base.replace(/^http/, "ws") + "/ws";
  if (typeof window !== "undefined") {
    const proto = window.location.protocol === "https:" ? "wss" : "ws";
    return `${proto}://${window.location.host}/ws`;
  }
  return "ws://localhost:8099/ws";
}
