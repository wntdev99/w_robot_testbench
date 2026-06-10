"use client";

import { useState } from "react";
import { api } from "@/lib/api";

// control.service 위젯 — service 호출 (1차: 빈 Request. 동적폼은 후속).
export function ServiceCall({ name, type }: { name: string; type: string }) {
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const call = async () => {
    setBusy(true);
    try { setResult(await api.callService(name, type, {})); }
    catch (e) { setResult({ error: String(e) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs text-muted break-all">{name} · {type}</div>
      <button onClick={call} disabled={busy || !name} className="px-3 py-1.5 rounded-card bg-primary text-white disabled:opacity-50">
        {busy ? "호출 중…" : "호출"}
      </button>
      {result != null && (
        <pre className="text-xs text-muted max-h-24 overflow-auto">{JSON.stringify(result).slice(0, 240)}</pre>
      )}
    </div>
  );
}
