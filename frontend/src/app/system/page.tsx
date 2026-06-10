"use client";

import { useEffect, useState } from "react";
import { api, type OwnedProc } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";

type Sys = Awaited<ReturnType<typeof api.systemStatus>>;
type Ctrl = Awaited<ReturnType<typeof api.controllerStatus>>;

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card bg-surface border border-border p-4">
      <div className="text-xs text-muted">{label}</div>
      <div className="text-lg font-semibold mt-1">{value}</div>
    </div>
  );
}

export default function SystemPage() {
  const [sys, setSys] = useState<Sys | null>(null);
  const [owned, setOwned] = useState<OwnedProc[]>([]);
  const [ctrl, setCtrl] = useState<Ctrl | null>(null);
  const [intrusion, setIntrusion] = useState<{ found: number } | null>(null);

  useWebSocket((e) => { if (e.type === "intrusion") setIntrusion(e.data as { found: number }); });

  useEffect(() => {
    const tick = () => {
      api.systemStatus().then(setSys).catch(() => {});
      api.processes().then((r) => setOwned(r.owned)).catch(() => {});
    };
    tick();
    api.controllerStatus().then(setCtrl).catch(() => {});
    const id = setInterval(tick, 3000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">시스템 / 인프라</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Card label="zenoh" value={sys?.zenoh ? "● ON" : "○ OFF"} />
        <Card label="201" value={sys?.controller_201 ? "● 함께" : "○ 단독"} />
        <Card label="CPU" value={sys ? `${sys.cpu_percent}%` : "–"} />
        <Card label="온도" value={sys?.temp_c != null ? `${sys.temp_c}℃` : "–"} />
        <Card label="노드" value={sys ? String(sys.node_count) : "–"} />
      </div>

      {ctrl && (
        <div className="text-sm text-muted">
          컨트롤러(201): {ctrl.reachable
            ? `연결 · load ${ctrl.stats?.loadavg ?? "?"} · ${ctrl.stats?.temp_c ?? "?"}℃`
            : "미연결"}
        </div>
      )}

      {intrusion && (
        <div className="rounded-card border border-warn bg-warn/10 p-3 text-sm">
          ⚠️ 관리되지 않는(난입) ROS 프로세스 {intrusion.found}개 감지 — 관리자에서 처리
        </div>
      )}

      <div>
        <h2 className="font-semibold mb-2">관리 프로세스 (owned-registry)</h2>
        <div className="rounded-card bg-surface border border-border divide-y divide-border text-sm">
          {owned.map((o) => (
            <div key={o.id} className="p-2.5 flex items-center gap-2">
              <span className="text-xs px-2 py-0.5 rounded bg-bg text-muted">{o.provenance}</span>
              <span className="font-mono">{o.id}</span>
              <span className="text-muted text-xs">{o.machine} · pid {o.pid}</span>
            </div>
          ))}
          {owned.length === 0 && <div className="p-2.5 text-muted">기동된 프로세스 없음</div>}
        </div>
      </div>
    </div>
  );
}
