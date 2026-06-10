"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { api, type Project, type RunResult } from "@/lib/api";
import { WidgetView } from "@/components/widgets/WidgetView";

export default function ProjectRunPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [project, setProject] = useState<Project | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.project(id).then(setProject).catch(() => {});
  }, [id]);

  const onRun = async () => {
    setBusy(true);
    try { setRun(await api.runProject(id)); } catch { /* ws surfaces */ } finally { setBusy(false); }
  };
  const onStop = async () => {
    setBusy(true);
    try { await api.stopProject(id); setRun(null); } finally { setBusy(false); }
  };

  if (!project) return <div className="text-muted">로딩…</div>;
  const live = run?.state === "live";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <div className="text-sm text-muted">{project.description}</div>
        </div>
        {!live ? (
          <button onClick={onRun} disabled={busy}
            className="px-4 py-2 rounded-card bg-primary text-white font-semibold disabled:opacity-50">
            {busy ? "수렴 중…" : "▶ 실행"}
          </button>
        ) : (
          <button onClick={onStop} disabled={busy}
            className="px-4 py-2 rounded-card bg-surface border border-border font-semibold">
            ■ 정지
          </button>
        )}
      </div>

      {run && (
        <div className="rounded-card bg-surface border border-border p-3 text-sm">
          상태: <b className={run.state === "live" ? "text-ok" : "text-warn"}>{run.state}</b>
          {run.missing.length > 0 && (
            <span className="text-danger"> · 누락: {run.missing.map((m) => m.name).join(", ")}</span>
          )}
          <span className="text-muted"> · {run.processes.map((p) => `${p.id}(${p.status})`).join(", ")}</span>
        </div>
      )}

      <div className="grid grid-cols-12 gap-3">
        {(project.layout?.widgets ?? []).map((w) => (
          <div key={w.id} style={{ gridColumn: `span ${w.pos.w}` }}
            className="rounded-card bg-surface border border-border p-4">
            <div className="text-sm font-semibold mb-2">{w.title}</div>
            <WidgetView widget={w} live={live} />
          </div>
        ))}
      </div>
    </div>
  );
}
