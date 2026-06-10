"use client";
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { api } from "@/lib/api";

// 서버 기동 시 '기존 ros2 종료 + baseline 기동' 시작 플랜이 대기 중이면 팝업으로 승인받음.
export function StartupPrompt() {
  const [plan, setPlan] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.adminStatus().then((s) => { if (s.startup_pending) setPlan(s.plan); }).catch(() => {});
  }, []);

  if (!plan) return null;

  const apply = async () => { setBusy(true); try { await api.adminApply(); } finally { setPlan(null); } };
  const skip = async () => { setBusy(true); try { await api.adminDismiss(); } finally { setPlan(null); } };

  const scope = (plan.kill_scope || []).map((m: string) => (m === "server" ? "서버(202)" : "컨트롤러(201)")).join(" + ");

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2">
          <AlertTriangle size={20} className="text-danger" />
          <div className="text-base font-bold">서버 시작 플랜 실행</div>
        </div>
        <p className="mt-2 text-sm text-ink-soft">
          {plan.kill_on_start && <>먼저 <b className="text-danger">{scope}의 기존 ros2 프로세스를 모두 종료</b>한 뒤, </>}
          zenoh 라우터 확인·기동 후 아래 baseline 프로세스를 순서대로 기동합니다.
        </p>
        <div className="mt-3 max-h-40 overflow-auto rounded-xl border border-surface-line divide-y divide-surface-line">
          {(plan.steps || []).map((s: any, i: number) => (
            <div key={i} className="flex items-center gap-2 px-3 py-1.5 text-xs">
              <span className="w-4 text-ink-faint">{i + 1}</span>
              <span className="flex-1 truncate"><b>{s.label}</b> <span className="text-ink-faint">{s.machine === "controller" ? "201" : "202"}</span></span>
              {s.delay_s ? <span className="text-ink-faint">+{s.delay_s}s</span> : null}
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11px] text-warn">⚠ control.launch 등 모터 런치 포함 시 로봇이 동작할 수 있습니다. 안전 공간·E-stop 준비를 확인하세요.</p>
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={skip} disabled={busy}
            className="rounded-xl bg-surface-muted px-4 py-2 text-sm font-medium text-ink-soft hover:bg-surface-line disabled:opacity-50">건너뛰기</button>
          <button onClick={apply} disabled={busy}
            className="rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">종료 후 기동(적용)</button>
        </div>
      </div>
    </div>
  );
}
