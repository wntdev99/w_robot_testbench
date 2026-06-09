import { apiBase } from "./config";

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
