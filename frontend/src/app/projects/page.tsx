"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api, type Project } from "@/lib/api";

export default function ProjectsPage() {
  const router = useRouter();
  const [projects, setProjects] = useState<Project[]>([]);
  const reload = () => api.projects().then((r) => setProjects(r.projects)).catch(() => {});
  useEffect(() => { reload(); }, []);

  const onNew = async () => {
    const p = await api.createProject({
      name: "새 프로젝트",
      layout: { grid: { cols: 12, row_h: 40 }, widgets: [] },
    });
    router.push(`/projects/${p.id}`);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">프로젝트</h1>
        <button onClick={onNew} className="px-4 py-2 rounded-card bg-primary text-white font-semibold">+ 새 프로젝트</button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {projects.map((p) => (
          <Link key={p.id} href={`/projects/${p.id}`}
            className="rounded-card bg-surface border border-border p-5 hover:border-primary transition-colors">
            <div className="flex items-center gap-2">
              <span className="font-semibold">{p.name}</span>
              <span className="text-xs px-2 py-0.5 rounded bg-bg text-muted">{p.origin}</span>
            </div>
            <div className="text-sm text-muted mt-2">{p.description}</div>
          </Link>
        ))}
        {projects.length === 0 && <div className="text-muted">프로젝트 없음 — 새로 만드세요.</div>}
      </div>
    </div>
  );
}
