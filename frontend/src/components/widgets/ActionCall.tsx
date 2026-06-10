"use client";

import { useState } from "react";
import { api } from "@/lib/api";

// control.action 위젯 — action goal 전송 (1차: 빈 goal. 동적폼은 후속).
export function ActionCall({ name, type }: { name: string; type: string }) {
  const [result, setResult] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try { setResult(await api.sendAction(name, type, {})); }
    catch (e) { setResult({ error: String(e) }); }
    finally { setBusy(false); }
  };
  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs text-muted break-all">{name} · {type}</div>
      <button onClick={send} disabled={busy || !name || !type} className="px-3 py-1.5 rounded-card bg-primary text-white disabled:opacity-50">
        {busy ? "전송 중…" : "goal 전송"}
      </button>
      {result != null && (
        <pre className="text-xs text-muted max-h-24 overflow-auto">{JSON.stringify(result).slice(0, 240)}</pre>
      )}
    </div>
  );
}
