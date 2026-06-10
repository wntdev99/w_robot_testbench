"use client";

import dynamic from "next/dynamic";
import { useTopicStream } from "@/hooks/useTopicStream";

// uPlot 은 window 의존 → SSR 비활성 동적 로드
const UPlotChart = dynamic(() => import("./UPlotChart").then((m) => m.UPlotChart), { ssr: false });

// plot.topic 위젯 — 토픽 스트림 → uPlot 실시간 시계열(첫 수치 필드) + 최근값.
export function PlotTopic({ topic, live }: { topic?: string; live: boolean }) {
  const { latest, history } = useTopicStream(live ? topic : undefined);
  if (!live) return <div className="text-muted text-sm">실행 시 스트림</div>;
  const t = history.map((h) => h.t);
  const v = history.map((h) => firstNumber(h.v) ?? 0);
  return (
    <div>
      <div className="text-xs text-muted mb-1">{topic} · {history.length} samples</div>
      {history.length >= 2 ? (
        <UPlotChart labels={["value"]} data={[t, v]} />
      ) : (
        <div className="text-muted text-xs h-12 flex items-center">수신 대기…</div>
      )}
      <pre className="text-xs text-muted mt-2 max-h-16 overflow-auto">
        {latest ? JSON.stringify(latest).slice(0, 140) : ""}
      </pre>
    </div>
  );
}

function firstNumber(v: unknown): number | null {
  if (typeof v === "number") return v;
  if (Array.isArray(v)) {
    for (const x of v) { const n = firstNumber(x); if (n != null) return n; }
  } else if (v && typeof v === "object") {
    for (const k of Object.keys(v)) { const n = firstNumber((v as Record<string, unknown>)[k]); if (n != null) return n; }
  }
  return null;
}
