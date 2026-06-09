"use client";
import { create } from "zustand";
import { wsUrl } from "./config";

export type TopicSample = { ts: number; values: any };

interface TbState {
  connected: boolean;
  system: any | null;
  zenoh: any | null;
  controller: any | null;
  processes: any[];
  diagnostics: Record<string, any>;
  topicData: Record<string, TopicSample>;
  estop: any | null;
  actions: Record<string, any>;   // goal_id -> {action, feedback?, result?}

  _ws?: WebSocket;
  _subs: Set<string>;
  connect: () => void;
  subscribe: (topic: string, type?: string) => void;
  unsubscribe: (topic: string) => void;
}

export const useTb = create<TbState>((set, get) => ({
  connected: false,
  system: null,
  zenoh: null,
  controller: null,
  processes: [],
  diagnostics: {},
  topicData: {},
  estop: null,
  actions: {},
  _subs: new Set(),

  connect: () => {
    if (get()._ws) return;
    const open = () => {
      const ws = new WebSocket(wsUrl());
      set({ _ws: ws });
      ws.onopen = () => {
        set({ connected: true });
        // 재연결 시 기존 구독 복원
        get()._subs.forEach((t) => ws.send(JSON.stringify({ op: "sub", topic: t })));
      };
      ws.onclose = () => {
        set({ connected: false, _ws: undefined });
        setTimeout(open, 1500);
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        const d = msg.data;
        switch (msg.type) {
          case "welcome":
            if (d.system) set({ system: d.system });
            if (d.processes) set({ processes: d.processes });
            if (d.diagnostics) set({ diagnostics: d.diagnostics });
            break;
          case "system":
            set({ system: d });
            break;
          case "processes":
            set({ processes: d });
            break;
          case "diagnostics":
            set({ diagnostics: { ...get().diagnostics, ...d } });
            break;
          case "topic_data":
            set({ topicData: { ...get().topicData, [d.topic]: { ts: msg.ts, values: d.values } } });
            break;
          case "estop":
            set({ estop: d });
            break;
          case "action_feedback":
            set({ actions: { ...get().actions, [d.goal_id]: { ...get().actions[d.goal_id], action: d.action, feedback: d.feedback } } });
            break;
          case "action_result":
            set({ actions: { ...get().actions, [d.goal_id]: { ...get().actions[d.goal_id], action: d.action, result: { status: d.status, result: d.result } } } });
            break;
        }
      };
    };
    open();
  },

  subscribe: (topic, type) => {
    const subs = get()._subs;
    if (subs.has(topic)) return;
    subs.add(topic);
    get()._ws?.send(JSON.stringify({ op: "sub", topic, type }));
  },
  unsubscribe: (topic) => {
    get()._subs.delete(topic);
    get()._ws?.send(JSON.stringify({ op: "unsub", topic }));
  },
}));
