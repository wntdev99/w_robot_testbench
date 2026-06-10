"use client";

import { useEffect, useState } from "react";
import { api, type BaselineItem } from "@/lib/api";

type Boot = Awaited<ReturnType<typeof api.bootStatus>>;

export default function AdminPage() {
  const [baseline, setBaseline] = useState<BaselineItem[]>([]);
  const [boot, setBoot] = useState<Boot | null>(null);
  const [busy, setBusy] = useState(false);

  const reload = () => {
    api.baseline().then((r) => setBaseline(r.baseline)).catch(() => {});
    api.bootStatus().then(setBoot).catch(() => {});
  };
  useEffect(() => { reload(); }, []);

  const up = async () => { setBusy(true); try { await api.baselineUp(); reload(); } finally { setBusy(false); } };
  const down = async () => { setBusy(true); try { await api.baselineDown(); reload(); } finally { setBusy(false); } };
  const resolve = async (action: "kill" | "cancel") => { setBusy(true); try { await api.bootResolve(action); reload(); } finally { setBusy(false); } };

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-bold">관리자</h1>

      <div>
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">baseline (동적 · 인프라 전제)</h2>
          <div className="flex gap-2">
            <button onClick={up} disabled={busy} className="px-3 py-1 rounded-card bg-primary text-white text-sm">▶ 전체 기동</button>
            <button onClick={down} disabled={busy} className="px-3 py-1 rounded-card bg-surface border border-border text-sm">■ 정지(zenoh 보존)</button>
          </div>
        </div>
        <div className="rounded-card bg-surface border border-border divide-y divide-border text-sm">
          {baseline.map((b) => (
            <div key={b.id} className="p-2.5 flex items-center gap-2">
              <span className={`w-2 h-2 rounded-full ${b.running ? "bg-ok" : "bg-muted"}`} />
              <span className="font-mono">{b.id}</span>
              <span className="text-muted text-xs">{b.machine}</span>
              {b.owned && <span className="text-xs px-1.5 rounded bg-bg text-muted">owned</span>}
              <span className="ml-auto text-xs text-muted">{b.running ? "running" : "stopped"}</span>
            </div>
          ))}
          {baseline.length === 0 && <div className="p-2.5 text-muted">baseline 비어있음(202 단독 모드)</div>}
        </div>
      </div>

      {boot && (
        <div className="rounded-card bg-surface border border-border p-3 text-sm space-y-2">
          <h2 className="font-semibold">부팅 게이트 (Clean-Slate)</h2>
          {boot.clean ? (
            <div className="text-ok">● Clean — 관리되지 않는 ROS 프로세스 없음</div>
          ) : (
            <>
              <div className="text-warn">⚠️ 관리되지 않는 ROS 프로세스 {boot.found}개</div>
              <div className="flex gap-2">
                <button onClick={() => resolve("kill")} disabled={busy} className="px-3 py-1 rounded-card bg-danger text-white text-sm">종료(zenoh 보존)</button>
                <button onClick={reload} className="px-3 py-1 rounded-card bg-surface border border-border text-sm">새로고침</button>
              </div>
            </>
          )}
        </div>
      )}

      <p className="text-muted text-xs">201 SSH 연결 설정(부트스트랩)은 후속 — 현재 202→201 키 배포 완료.</p>
    </div>
  );
}
