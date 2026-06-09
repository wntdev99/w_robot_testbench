"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";
import { cn } from "@/lib/utils";

type Status = Awaited<ReturnType<typeof api.systemStatus>>;

function Chip({ on, label }: { on: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-sm">
      <span className={cn("w-2 h-2 rounded-full", on ? "bg-ok" : "bg-muted")} />
      {label}
    </span>
  );
}

// 전역 상태바 (DESIGN v0.3 §8.1) — zenoh/201/CPU/온도
export function StatusPulse() {
  const [s, setS] = useState<Status | null>(null);
  const { connected } = useWebSocket();

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await api.systemStatus();
        if (alive) setS(r);
      } catch {
        if (alive) setS(null);
      }
    };
    tick();
    const id = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex items-center gap-5">
      <Chip on={!!s?.zenoh} label="zenoh" />
      <Chip on={!!s?.controller_201} label={s?.controller_201 ? "201 함께" : "201 단독"} />
      <span className="text-sm text-muted">CPU {s?.cpu_percent ?? "–"}%</span>
      <span className="text-sm text-muted">{s?.temp_c != null ? `${s.temp_c}℃` : "–"}</span>
      <span className="text-sm text-muted">노드 {s?.node_count ?? "–"}</span>
      <Chip on={connected} label="ws" />
    </div>
  );
}
