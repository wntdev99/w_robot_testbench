"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { api, type Project } from "@/lib/api";

export default function ProjectsPage() {
  const [projects, setProjects] = useState<Project[]>([]);
  useEffect(() => {
    api.projects().then((r) => setProjects(r.projects)).catch(() => {});
  }, []);
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">프로젝트</h1>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {projects.map((p) => (
          <Link
            key={p.id}
            href={`/projects/${p.id}`}
            className="rounded-card bg-surface border border-border p-5 hover:border-primary transition-colors"
          >
            <div className="flex items-center gap-2">
              <span className="font-semibold">{p.name}</span>
              {p.origin === "builtin" && (
                <span className="text-xs px-2 py-0.5 rounded bg-bg text-muted">builtin</span>
              )}
            </div>
            <div className="text-sm text-muted mt-2">{p.description}</div>
          </Link>
        ))}
        {projects.length === 0 && <div className="text-muted">프로젝트 없음</div>}
      </div>
    </div>
  );
}
