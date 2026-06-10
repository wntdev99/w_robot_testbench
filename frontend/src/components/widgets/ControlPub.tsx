"use client";

import { useState } from "react";
import { api } from "@/lib/api";

// control.topic_pub 위젯 — Twist 발행(텔레옵 수동 제어). 0 정지 버튼 포함.
export function ControlPub({ name, type }: { name: string; type: string }) {
  const [lx, setLx] = useState(0);
  const [az, setAz] = useState(0);
  const send = () =>
    api.publish(name, type, { linear: { x: lx, y: 0, z: 0 }, angular: { x: 0, y: 0, z: az } }).catch(() => {});
  const stop = () => { setLx(0); setAz(0); api.publish(name, type, {}).catch(() => {}); };
  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs text-muted break-all">{name}</div>
      <label className="flex items-center justify-between gap-2">
        linear.x
        <input type="number" step="0.05" value={lx} onChange={(e) => setLx(+e.target.value)}
          className="border border-border rounded px-2 py-1 w-24" />
      </label>
      <label className="flex items-center justify-between gap-2">
        angular.z
        <input type="number" step="0.1" value={az} onChange={(e) => setAz(+e.target.value)}
          className="border border-border rounded px-2 py-1 w-24" />
      </label>
      <div className="flex gap-2 pt-1">
        <button onClick={send} className="px-3 py-1.5 rounded-card bg-primary text-white">발행</button>
        <button onClick={stop} className="px-3 py-1.5 rounded-card bg-surface border border-border">0 정지</button>
      </div>
    </div>
  );
}
