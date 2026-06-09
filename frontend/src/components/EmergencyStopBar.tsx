"use client";

import { useState } from "react";
import { OctagonX } from "lucide-react";
import { api } from "@/lib/api";

// 전역 Emergency Stop (DESIGN v0.3 §8.1, §10) — 상시 노출.
// 불변식: E-stop은 모터/액추에이터 정지이지 프로세스 kill 아님(부속 D §4).
export function EmergencyStopBar() {
  const [busy, setBusy] = useState(false);
  const onStop = async () => {
    setBusy(true);
    try {
      await api.emergencyStop();
    } catch {
      /* surfaced via ws */
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      onClick={onStop}
      disabled={busy}
      className="flex items-center gap-2 px-4 py-2 rounded-card bg-danger text-white text-sm font-bold hover:opacity-90 disabled:opacity-50"
    >
      <OctagonX size={18} />
      {busy ? "정지 중…" : "전체 정지"}
    </button>
  );
}
