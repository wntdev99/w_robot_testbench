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
  estop: () => req<any>("/api/emergency/stop", { method: "POST" }),
};
