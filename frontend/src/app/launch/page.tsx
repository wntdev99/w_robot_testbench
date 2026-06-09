"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { Card, CardTitle } from "@/components/Card";
import { cn } from "@/lib/cn";

const STATE_COLOR: Record<string, string> = {
  running: "text-ok", external: "text-brand-600", starting: "text-warn",
  stopping: "text-warn", failed: "text-danger", stopped: "text-ink-faint",
};

export default function LaunchPage() {
  const processes = useTb((s) => s.processes);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = () => api.profiles().then(setProfiles).catch(() => {});
  useEffect(() => { load(); }, []);

  const toggle = async (p: any) => {
    setBusy(p.id);
    try { await (p.up ? api.profileDown(p.id) : api.profileUp(p.id)); await load(); }
    finally { setBusy(null); }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">런치 오케스트레이션</h1>

      <Card>
        <CardTitle>프로파일</CardTitle>
        <div className="space-y-2">
          {profiles.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-3">
              <div>
                <div className="text-sm font-semibold">{p.label}</div>
                <div className="text-xs text-ink-faint">
                  {p.id}{p.persistent && " · 필수"}{p.exclusive && " · 단독"}
                </div>
              </div>
              {p.persistent ? (
                <span className="text-xs text-ink-faint">자동 기동</span>
              ) : (
                <button
                  onClick={() => toggle(p)}
                  disabled={busy === p.id}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:opacity-50",
                    p.up ? "bg-danger/10 text-danger" : "bg-brand-50 text-brand-700",
                  )}
                >
                  {busy === p.id ? "…" : p.up ? "■ 종료" : "▶ 기동"}
                </button>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>실행 중 프로세스</CardTitle>
        <div className="space-y-1 text-sm">
          {processes.length === 0 && <span className="text-ink-faint">없음</span>}
          {processes.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-surface-line py-1.5">
              <span className={cn("w-16 text-xs font-medium", STATE_COLOR[r.state] ?? "")}>{r.state}</span>
              <span className="font-mono text-xs text-ink-soft">{r.id}</span>
              <span className="ml-auto text-xs text-ink-faint">{r.machine}{r.pid ? ` · pid ${r.pid}` : ""}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
