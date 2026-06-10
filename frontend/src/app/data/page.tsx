"use client";

import { useEffect, useState } from "react";
import { api, type RunRecord } from "@/lib/api";

const API = process.env.NEXT_PUBLIC_API_BASE ?? "";

export default function DataPage() {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  useEffect(() => { api.records().then((r) => setRuns(r.runs)).catch(() => {}); }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">데이터 자산</h1>
      <div className="space-y-2">
        {runs.map((r) => (
          <div key={r.run_id} className="rounded-card bg-surface border border-border p-4 text-sm">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="font-semibold">{r.run_id}</span>
              {r.verdict ? (
                <span className={`px-2 py-0.5 rounded text-white text-xs ${r.verdict.result === "PASS" ? "bg-ok" : "bg-danger"}`}>
                  {r.verdict.result}
                </span>
              ) : (
                <span className="text-xs text-muted">미판정</span>
              )}
              <span className="text-xs text-muted">{r.started_at}</span>
            </div>
            <div className="text-xs text-muted mt-1">
              {r.verdict?.comment && <>코멘트: {r.verdict.comment} · </>}
              counters: {JSON.stringify(r.counters)} ·{" "}
              {r.topics.map((t) => {
                const f = t.replace(/^\//, "").replace(/\//g, "__") + ".csv";
                return (
                  <a key={t} href={`${API}/api/records/${r.run_id}/files/${f}`}
                    className="text-primary underline mr-2" download>{f}</a>
                );
              })}
            </div>
          </div>
        ))}
        {runs.length === 0 && <div className="text-muted">실행 기록 없음</div>}
      </div>
    </div>
  );
}
