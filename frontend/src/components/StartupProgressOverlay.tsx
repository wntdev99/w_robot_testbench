"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Check, X, Circle } from "lucide-react";
import { useTb } from "@/lib/store";
import { cn } from "@/lib/cn";

// 시작 플랜(기존 ros2 종료 → baseline 순차 기동) 진행을 전체화면 블로킹 오버레이로 표시.
// 진행 중에는 닫기 버튼이 없어 사용자가 다른 조작을 못 하도록 막는다.
export function StartupProgressOverlay() {
  const p = useTb((s) => s.startupProgress);
  const [show, setShow] = useState(false);
  const seenActive = useRef(false);   // 이번 세션에서 '진행 중'을 본 적 있는지(완료 스냅샷 오표시 방지)

  useEffect(() => {
    if (!p) return;
    if (p.active) { seenActive.current = true; setShow(true); return; }
    if (seenActive.current) {           // 진행을 보던 클라이언트만 완료/실패를 잠시 표시
      setShow(true);
      const t = setTimeout(() => { setShow(false); seenActive.current = false; }, 1600);
      return () => clearTimeout(t);
    }
  }, [p]);

  if (!show || !p) return null;
  const failed = p.phase === "failed";
  const pct = p.total ? Math.round(((p.current ?? 0) / p.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-ink/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-card">
        <div className="flex items-center gap-2">
          {p.active ? <Loader2 size={18} className="animate-spin text-brand-600" />
            : failed ? <X size={18} className="text-danger" />
            : <Check size={18} className="text-ok" />}
          <div className="text-base font-bold">
            {p.active ? "시작 플랜 진행 중" : failed ? "시작 플랜 실패" : "시작 플랜 완료"}
          </div>
        </div>
        <p className="mt-1 text-sm text-ink-soft">{p.message}</p>

        <div className="mt-3 space-y-1.5">
          {(p.steps || []).map((s: any, i: number) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              {s.state === "running" ? <Loader2 size={14} className="animate-spin text-brand-600" />
                : s.state === "done" ? <Check size={14} className="text-ok" />
                : s.state === "failed" ? <X size={14} className="text-danger" />
                : <Circle size={14} className="text-surface-line" />}
              <span className={cn(s.state === "pending" ? "text-ink-faint" : "text-ink")}>{s.label}</span>
            </div>
          ))}
        </div>

        {p.total ? (
          <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-muted">
            <div className={cn("h-full transition-all", failed ? "bg-danger" : "bg-brand-500")} style={{ width: `${pct}%` }} />
          </div>
        ) : null}

        {p.active && <p className="mt-2 text-[11px] text-ink-faint">완료될 때까지 기다려 주세요…</p>}
      </div>
    </div>
  );
}
