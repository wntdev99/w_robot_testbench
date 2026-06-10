"use client";

import { useTopicStream } from "@/hooks/useTopicStream";

type DiagStatus = {
  name?: string;
  hardware_id?: string;
  values?: { key: string; value: string }[];
};

// diagnostics 위젯 — /diagnostics(DiagnosticArray) 구독, hardware_id 필터, key-value 표.
export function DiagnosticsView({ topic, filter, live }: { topic?: string; filter?: string; live: boolean }) {
  const { latest } = useTopicStream(live ? topic : undefined);
  if (!live) return <div className="text-muted text-sm">실행 시 스트림</div>;
  const status: DiagStatus[] = (latest as { status?: DiagStatus[] })?.status ?? [];
  const rows = status.filter((s) => !filter || (s.hardware_id ?? "").includes(filter));
  return (
    <div className="max-h-48 overflow-auto text-xs">
      {rows.length === 0 && <div className="text-muted">수신 대기…</div>}
      {rows.map((s, i) => (
        <div key={i} className="border-b border-border py-1">
          <div className="font-semibold">{s.hardware_id ?? s.name}</div>
          <div className="text-muted">
            {(s.values ?? [])
              .filter((kv) => /temp|current|effort|velocity/i.test(kv.key))
              .map((kv) => `${kv.key}=${kv.value}`)
              .join(" · ")}
          </div>
        </div>
      ))}
    </div>
  );
}
