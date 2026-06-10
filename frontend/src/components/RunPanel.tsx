"use client";

import { useState } from "react";
import { api, type Project } from "@/lib/api";
import { useWebSocket } from "@/hooks/useWebSocket";

// 실행 패널 — 기록(record)·cycle 러너·수동 verdict (P4, 부속 D §2-E/F)
export function RunPanel({ project, live }: { project: Project; live: boolean }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [cycle, setCycle] = useState<{ count: number; target: number } | null>(null);
  const [verdictDone, setVerdictDone] = useState(false);
  const [comment, setComment] = useState("");

  useWebSocket((e) => {
    if (e.type === "cycle_progress") setCycle(e.data as { count: number; target: number });
    if (e.type === "cycle_done") setCycle((c) => (c ? { ...c, ...(e.data as object) } : null));
  });

  const recStart = async () => { const r = await api.recordStart(project.id); setRunId(r.run_id); setVerdictDone(false); };
  const recStop = async () => { await api.recordStop(); };
  const cycStart = async () => { const r = await api.cycleStart(project.id); setCycle({ count: 0, target: r.target }); };
  const cycStop = async () => { await api.cycleStop(project.id); };
  const verdict = async (result: "PASS" | "FAIL") => {
    if (!runId) return;
    await api.recordVerdict(runId, result, comment);
    setVerdictDone(true);
  };

  const hasCycle = project.runner?.mode === "cycle";
  if (!live) return null;

  return (
    <div className="rounded-card bg-surface border border-border p-3 text-sm space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-semibold">기록</span>
        {!runId ? (
          <button onClick={recStart} className="px-3 py-1 rounded-card bg-primary text-white">● 기록 시작</button>
        ) : (
          <>
            <span className="text-xs text-muted">{runId}</span>
            <button onClick={recStop} className="px-3 py-1 rounded-card bg-surface border border-border">■ 기록 정지</button>
          </>
        )}
        {hasCycle && (
          <>
            <span className="font-semibold ml-4">반복</span>
            {!cycle || cycle.count >= cycle.target ? (
              <button onClick={cycStart} className="px-3 py-1 rounded-card bg-primary text-white">▶ cycle</button>
            ) : (
              <button onClick={cycStop} className="px-3 py-1 rounded-card bg-danger text-white">■ 중단</button>
            )}
            {cycle && <span className="text-xs">{cycle.count}/{cycle.target}</span>}
          </>
        )}
      </div>
      {runId && !verdictDone && (
        <div className="flex items-center gap-2">
          <span className="font-semibold">판정(수동)</span>
          <input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="코멘트"
            className="border border-border rounded px-2 py-1 text-xs flex-1" />
          <button onClick={() => verdict("PASS")} className="px-3 py-1 rounded-card bg-ok text-white">PASS</button>
          <button onClick={() => verdict("FAIL")} className="px-3 py-1 rounded-card bg-danger text-white">FAIL</button>
        </div>
      )}
      {verdictDone && <div className="text-xs text-ok">verdict 기록됨 — 데이터 자산에서 확인</div>}
    </div>
  );
}
