"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api, type Project, type RunResult } from "@/lib/api";
import { WidgetView } from "@/components/widgets/WidgetView";
import { ProjectEditor } from "@/components/ProjectEditor";

export default function ProjectRunPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [id, setId] = useState(params.id);
  const [project, setProject] = useState<Project | null>(null);
  const [run, setRun] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => { api.project(id).then(setProject).catch(() => {}); }, [id]);

  const onRun = async () => { setBusy(true); try { setRun(await api.runProject(id)); } catch { /* ws */ } finally { setBusy(false); } };
  const onStop = async () => { setBusy(true); try { await api.stopProject(id); setRun(null); } finally { setBusy(false); } };
  const onDuplicate = async () => { const d = await api.duplicateProject(id); setId(d.id); setProject(d); setEditing(true); };
  const onDelete = async () => { if (confirm("이 프로젝트를 삭제할까요?")) { await api.deleteProject(id); router.push("/projects"); } };

  if (!project) return <div className="text-muted">로딩…</div>;
  const live = run?.state === "live";

  if (editing) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">편집 · {project.name}</h1>
          <button onClick={() => setEditing(false)} className="px-4 py-2 rounded-card bg-surface border border-border">취소</button>
        </div>
        <ProjectEditor project={project} onSaved={(p) => { setProject(p); setId(p.id); setEditing(false); }} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{project.name}</h1>
          <div className="text-sm text-muted">{project.description}</div>
        </div>
        <div className="flex gap-2">
          {!live ? (
            <button onClick={onRun} disabled={busy} className="px-4 py-2 rounded-card bg-primary text-white font-semibold disabled:opacity-50">
              {busy ? "수렴 중…" : "▶ 실행"}
            </button>
          ) : (
            <button onClick={onStop} className="px-4 py-2 rounded-card bg-surface border border-border font-semibold">■ 정지</button>
          )}
          {!live && project.origin === "user" && (
            <button onClick={() => setEditing(true)} className="px-3 py-2 rounded-card bg-surface border border-border text-sm">편집</button>
          )}
          {!live && <button onClick={onDuplicate} className="px-3 py-2 rounded-card bg-surface border border-border text-sm">복제</button>}
          {!live && project.origin === "user" && (
            <button onClick={onDelete} className="px-3 py-2 rounded-card bg-surface border border-border text-sm text-danger">삭제</button>
          )}
        </div>
      </div>

      {run && (
        <div className="rounded-card bg-surface border border-border p-3 text-sm">
          상태: <b className={run.state === "live" ? "text-ok" : "text-warn"}>{run.state}</b>
          {run.missing.length > 0 && <span className="text-danger"> · 누락: {run.missing.map((m) => m.name).join(", ")}</span>}
          <span className="text-muted"> · {run.processes.map((p) => `${p.id}(${p.status})`).join(", ")}</span>
        </div>
      )}

      <div className="grid grid-cols-12 gap-3">
        {(project.layout?.widgets ?? []).map((w) => (
          <div key={w.id} style={{ gridColumn: `span ${w.pos.w}` }} className="rounded-card bg-surface border border-border p-4">
            <div className="text-sm font-semibold mb-2">{w.title}</div>
            <WidgetView widget={w} live={live} />
          </div>
        ))}
        {(project.layout?.widgets ?? []).length === 0 && (
          <div className="col-span-12 text-muted text-sm">위젯 없음 — 편집에서 추가하세요.</div>
        )}
      </div>
    </div>
  );
}
