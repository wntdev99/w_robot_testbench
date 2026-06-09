// API 클라이언트 — FastAPI 백엔드 (DESIGN v0.3 §7). bt_gui api/client 계승.
// rewrites(next.config)로 /api/* 가 백엔드로 프록시됨.

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export type Envelope<T> = { ok: boolean; data?: T; error?: { code: string; message: string } };

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const body = (await res.json()) as Envelope<T> | T;
  if (body && typeof body === "object" && "ok" in body) {
    const env = body as Envelope<T>;
    if (!env.ok) throw new Error(env.error?.message ?? "request failed");
    return env.data as T;
  }
  return body as T; // 엔벨로프 없는 응답(health 등)
}

export const api = {
  health: () => req<{ ok: boolean; ros: boolean }>("/api/health"),
  systemStatus: () =>
    req<{
      zenoh: boolean;
      controller_201: boolean;
      cpu_percent: number;
      mem_percent: number;
      temp_c: number | null;
      node_count: number;
    }>("/api/system/status"),
  bootStatus: () => req<{ clean: boolean; found: number; scan: unknown }>("/api/boot/status"),
  bootResolve: (action: "kill" | "cancel") =>
    req("/api/boot/resolve", { method: "POST", body: JSON.stringify({ action }) }),
  emergencyStop: () => req("/api/emergency/stop", { method: "POST" }),
};
