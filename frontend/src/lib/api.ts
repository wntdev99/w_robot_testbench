import { apiBase } from "./config";

export const recordingDownloadUrl = (file: string) =>
  `${apiBase()}/api/recordings/${encodeURIComponent(file)}/download`;

export const cameraStreamUrl = (topic: string) =>
  `${apiBase()}/api/camera/stream?topic=${encodeURIComponent(topic)}`;

export const navMapUrl = () => `${apiBase()}/api/nav/map.png`;

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiBase() + path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => req<{ ok: boolean; version: string }>("/api/health"),
  systemStatus: () => req<any>("/api/system/status"),
  profiles: () => req<any[]>("/api/profiles"),
  processes: () => req<any[]>("/api/processes"),
  profileUp: (id: string) => req<any>(`/api/profiles/${id}/up`, { method: "POST" }),
  profileDown: (id: string) => req<any>(`/api/profiles/${id}/down`, { method: "POST" }),
  launchFiles: (machine: "server" | "controller" = "server") =>
    req<{ package: string; file: string; path: string }[]>(`/api/launch/files?machine=${machine}`),
  runLaunch: (machine: string, pkg: string, file: string, args = "") =>
    req<any>("/api/launch/run", { method: "POST", body: JSON.stringify({ machine, package: pkg, file, args }) }),
  stopProcess: (id: string) => req<any>("/api/launch/stop", { method: "POST", body: JSON.stringify({ id }) }),
  runningLaunches: (machine: "server" | "controller" = "server") =>
    req<{ pid: number | null; package: string; file: string }[]>(`/api/processes/running?machine=${machine}`),
  snapshots: () => req<{ name: string; updated: number }[]>("/api/snapshots"),
  saveSnapshot: (name: string, data: any) =>
    req<any>("/api/snapshots", { method: "POST", body: JSON.stringify({ name, data }) }),
  loadSnapshot: (name: string) => req<{ name: string; data: any }>(`/api/snapshots/${encodeURIComponent(name)}`),
  deleteSnapshot: (name: string) => req<any>(`/api/snapshots/${encodeURIComponent(name)}`, { method: "DELETE" }),
  recStart: (body: { name: string; topics: { topic: string; msgType?: string }[]; diagnostics: boolean; system: boolean }) =>
    req<{ id: string }>("/api/recordings/start", { method: "POST", body: JSON.stringify(body) }),
  recStop: (id: string) => req<{ ok: boolean; file?: string; rows?: number; columns?: number }>(
    "/api/recordings/stop", { method: "POST", body: JSON.stringify({ id }) }),
  recActive: () => req<{ id: string; name: string; active: boolean; rows: number; elapsed_s: number }[]>("/api/recordings/active"),
  recordings: () => req<{ file: string; size: number; rows: number | null; name: string | null }[]>("/api/recordings"),
  cameraTopics: () => req<{ available: boolean; topics: { topic: string; type: string; compressed: boolean }[] }>("/api/camera/topics"),
  navMeta: () => req<{ available: boolean; has_map: boolean; resolution?: number; width?: number; height?: number; origin?: { x: number; y: number } }>("/api/nav/map/meta"),
  navOverlay: () => req<{ pose: { x: number; y: number; yaw: number } | null; footprint: number[][]; scan: number[][] }>("/api/nav/overlay"),
  navCancel: () => req<Record<string, any>>("/api/nav/cancel", { method: "POST" }),
  topics: (includeHidden = false) =>
    req<{ topic: string; types: string[]; publishers: number; subscribers: number; plottable: boolean }[]>(
      `/api/topics?include_hidden=${includeHidden}`,
    ),
  topicType: (t: string) => req<any>(`/api/topics/type?topic=${encodeURIComponent(t)}`),
  topicFields: (topic: string, type?: string) =>
    req<{
      topic: string; type: string; plottable: boolean;
      fields: { path: string; base_type: string; array: boolean; plottable: boolean }[];
      plottable_fields: { path: string; base_type: string; array: boolean; plottable: boolean }[];
    }>(`/api/topics/fields?topic=${encodeURIComponent(topic)}${type ? `&type=${encodeURIComponent(type)}` : ""}`),
  diagnostics: () => req<Record<string, any>>("/api/diagnostics"),
  subsystems: () => req<any[]>("/api/subsystems"),
  controllers: () => req<any[]>("/api/controllers"),
  switchController: (activate: string[], deactivate: string[]) =>
    req<any>("/api/controllers/switch", {
      method: "POST",
      body: JSON.stringify({ activate, deactivate }),
    }),
  publish: (topic: string, type: string, data: any) =>
    req<any>("/api/publish", { method: "POST", body: JSON.stringify({ topic, type, data }) }),
  services: () => req<{ service: string; types: string[] }[]>("/api/services"),
  serviceFields: (service: string, type?: string) =>
    req<{ service: string; type: string; fields: { path: string; base_type: string; array: boolean; plottable: boolean }[] }>(
      `/api/services/fields?service=${encodeURIComponent(service)}${type ? `&type=${encodeURIComponent(type)}` : ""}`,
    ),
  callService: (type: string, name: string, request: any) =>
    req<any>("/api/service", { method: "POST", body: JSON.stringify({ type, name, request }) }),
  actions: () => req<{ action: string; types: string[] }[]>("/api/actions"),
  actionFields: (action: string, type?: string) =>
    req<{ action: string; type: string; fields: { path: string; base_type: string; array: boolean; plottable: boolean }[] }>(
      `/api/actions/fields?action=${encodeURIComponent(action)}${type ? `&type=${encodeURIComponent(type)}` : ""}`,
    ),
  sendAction: (type: string, name: string, goal: any) =>
    req<{ goal_id: string; accepted: boolean }>("/api/action", { method: "POST", body: JSON.stringify({ type, name, goal }) }),
  cancelAction: (goal_id: string) =>
    req<any>("/api/action/cancel", { method: "POST", body: JSON.stringify({ goal_id }) }),
  estop: () => req<any>("/api/emergency/stop", { method: "POST" }),
};
