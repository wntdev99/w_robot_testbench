"use client";
import { useState } from "react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { OctagonX } from "lucide-react";

export function EmergencyStopBar() {
  const [busy, setBusy] = useState(false);
  const estop = useTb((s) => s.estop);

  const fire = async () => {
    if (busy) return;
    setBusy(true);
    try { await api.estop(); } catch { /* noop */ } finally { setBusy(false); }
  };

  return (
    <div className="flex items-center gap-3 bg-danger/5 border-b border-danger/20 px-5 h-12">
      <button
        onClick={fire}
        disabled={busy}
        className="flex items-center gap-2 rounded-xl bg-danger px-4 py-1.5 text-sm font-bold text-white shadow-card active:scale-95 transition disabled:opacity-60"
      >
        <OctagonX size={16} />
        {busy ? "정지 중…" : "비상 정지 (E-STOP)"}
      </button>
      <span className="text-xs text-ink-faint">
        모든 cmd_vel 0 + 활성 컨트롤러 비활성
      </span>
      {estop && (
        <span className="ml-auto text-xs text-danger">
          마지막 정지: cmd_vel {estop.cmd_vel_zeroed ? "✓" : "✗"} · 비활성 {estop.deactivated?.length ?? 0}개
        </span>
      )}
    </div>
  );
}
