// API 클라이언트 — FastAPI 백엔드 (DESIGN v0.3 §7). bt_gui api/client 계승.
// rewrites(next.config)로 /api/* 가 백엔드로 프록시됨.

const BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

// WS URL — rewrites는 WS 미프록시. API_BASE 설정 시 백엔드로 직접(ws://host:8080/api/ws).
export function wsUrl(path: string): string {
  const base = process.env.NEXT_PUBLIC_API_BASE;
  if (base) return base.replace(/^http/, "ws") + path;
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}${path}`;
}

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
  runDecision: (id: string, action: "kill" | "keep" | "abort") =>
    req<RunResult>(`/api/projects/${id}/run/decision`, { method: "POST", body: JSON.stringify({ action }) }),
  stopProject: (id: string) => req<{ stopped: string[] }>(`/api/projects/${id}/stop`, { method: "POST" }),
  publish: (topic: string, type: string, values: Record<string, unknown>) =>
    req("/api/publish", { method: "POST", body: JSON.stringify({ topic, type, values }) }),
  baseline: () => req<{ baseline: BaselineItem[] }>("/api/baseline"),
  baselineUp: () => req("/api/baseline/up", { method: "POST" }),
  baselineDown: () => req("/api/baseline/down", { method: "POST" }),
  // P2 저작 CRUD + introspect
  createProject: (p: Partial<Project>) =>
    req<Project>("/api/projects", { method: "POST", body: JSON.stringify(p) }),
  updateProject: (id: string, p: Project) =>
    req<Project>(`/api/projects/${id}`, { method: "PUT", body: JSON.stringify(p) }),
  deleteProject: (id: string) => req(`/api/projects/${id}`, { method: "DELETE" }),
  duplicateProject: (id: string, name?: string) =>
    req<Project>(`/api/projects/${id}/duplicate`, { method: "POST", body: JSON.stringify({ name }) }),
  topics: () => req<{ topics: { name: string; types: string[] }[] }>("/api/topics"),
  typeFields: (type: string) =>
    req<{ type: string; fields: Record<string, FieldNode> }>(`/api/types/${encodeURIComponent(type)}/fields`),
};

export type FieldNode = { type: string; array: boolean; fields?: Record<string, FieldNode> };

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
  missing: { kind: string; name: string; widget?: string; reason?: string }[];
  orphans?: string[];
};
export type BaselineItem = { id: string; machine: string; running: boolean; owned: boolean };
