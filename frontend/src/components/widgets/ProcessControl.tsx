"use client";

import { useState } from "react";
import { api, type Widget } from "@/lib/api";

// process 위젯 — 런치/노드 ad-hoc 실행·정지 (사용자 비전: 화면에서 런치 실행).
// widget.id를 프로세스 id로 사용 → spawn/kill. provenance=ad-hoc(부속 D §5).
export function ProcessControl({ widget }: { widget: Widget }) {
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [pid, setPid] = useState<number | null>(null);

  const start = async () => {
    if (!widget.command) return;
    setBusy(true);
    try {
      const r = await api.spawnProcess(widget.id, widget.command, widget.machine ?? "server");
      setPid(r.pid); setRunning(true);
    } finally { setBusy(false); }
  };
  const stop = async () => {
    setBusy(true);
    try { await api.killProcess(widget.id); setRunning(false); setPid(null); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs text-muted break-all">{widget.machine ?? "server"} · {widget.command}</div>
      <div className="flex items-center gap-2">
        {!running ? (
          <button onClick={start} disabled={busy || !widget.command} className="px-3 py-1.5 rounded-card bg-primary text-white disabled:opacity-50">▶ 실행</button>
        ) : (
          <button onClick={stop} disabled={busy} className="px-3 py-1.5 rounded-card bg-danger text-white">■ 정지</button>
        )}
        <span className="text-xs text-muted">{running ? `실행 중 (pid ${pid})` : "정지됨"}</span>
      </div>
    </div>
  );
}
