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
  projects: () => req<{ projects: Project[] }>("/api/projects"),
  project: (id: string) => req<Project>(`/api/projects/${id}`),
  runProject: (id: string) => req<RunResult>(`/api/projects/${id}/run`, { method: "POST" }),
  stopProject: (id: string) => req<{ stopped: string[] }>(`/api/projects/${id}/stop`, { method: "POST" }),
  publish: (topic: string, type: string, values: Record<string, unknown>) =>
    req("/api/publish", { method: "POST", body: JSON.stringify({ topic, type, values }) }),
  baseline: () => req<{ baseline: BaselineItem[] }>("/api/baseline"),
  baselineUp: () => req("/api/baseline/up", { method: "POST" }),
  baselineDown: () => req("/api/baseline/down", { method: "POST" }),
};

export type Widget = {
  id: string; kind: string; title: string;
  pos: { x: number; y: number; w: number; h: number };
  name?: string; type?: string; topic?: string; hardware_id_filter?: string;
};
export type Project = {
  id: string; name: string; description?: string; origin: string;
  layout?: { grid?: { cols: number; row_h: number }; widgets?: Widget[] };
  processes?: unknown[]; runner?: { mode: string };
};
export type RunResult = {
  id: string; state: string;
  processes: { id: string; status: string }[];
  missing: { kind: string; name: string; widget?: string }[];
};
export type BaselineItem = { id: string; machine: string; running: boolean; owned: boolean };
