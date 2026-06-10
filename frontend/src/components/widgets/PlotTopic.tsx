"use client";

import { useTopicStream } from "@/hooks/useTopicStream";

// plot.topic 위젯 — 토픽 스트림 수신 + SVG 스파크라인(첫 수치 필드) + 최근값.
// (uPlot 고도화는 후순위, P1 1차는 의존성 없는 SVG)
export function PlotTopic({ topic, live }: { topic?: string; live: boolean }) {
  const { latest, history } = useTopicStream(live ? topic : undefined);
  if (!live) return <div className="text-muted text-sm">실행 시 스트림</div>;
  return (
    <div>
      <div className="text-xs text-muted mb-1">{topic} · {history.length} samples</div>
      <Spark history={history} />
      <pre className="text-xs text-muted mt-2 max-h-20 overflow-auto">
        {latest ? JSON.stringify(latest).slice(0, 180) : "수신 대기…"}
      </pre>
    </div>
  );
}

function Spark({ history }: { history: { t: number; v: unknown }[] }) {
  const nums = history.map((h) => firstNumber(h.v)).filter((n): n is number => n != null);
  if (nums.length < 2) return null;
  const min = Math.min(...nums), max = Math.max(...nums), rng = max - min || 1;
  const pts = nums
    .map((n, i) => `${(i / (nums.length - 1)) * 100},${30 - ((n - min) / rng) * 28}`)
    .join(" ");
  return (
    <svg viewBox="0 0 100 30" preserveAspectRatio="none" className="w-full h-12">
      <polyline points={pts} fill="none" stroke="var(--primary)" strokeWidth="1" />
    </svg>
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
