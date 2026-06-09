"use client";
import { useTb } from "@/lib/store";
import { Card, CardTitle } from "@/components/Card";
import { cn } from "@/lib/cn";

export default function SystemPage() {
  const system = useTb((s) => s.system);
  const temps = (system?.temperatures ?? {}) as Record<string, number>;
  const net = system?.net;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">시스템 / 인프라</h1>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardTitle>CPU</CardTitle>
          <div className="text-2xl font-bold">{system?.cpu_percent?.toFixed(0) ?? "—"}%</div>
        </Card>
        <Card>
          <CardTitle>메모리</CardTitle>
          <div className="text-2xl font-bold">{system?.mem?.percent ?? "—"}%</div>
        </Card>
        <Card>
          <CardTitle>인터넷</CardTitle>
          <div className={cn("text-2xl font-bold", system?.internet ? "text-ok" : "text-danger")}>
            {system?.internet ? "정상" : "끊김"}
          </div>
        </Card>
        <Card>
          <CardTitle>컨트롤러 201</CardTitle>
          <div className={cn("text-2xl font-bold", system?.controller_reachable ? "text-ok" : "text-ink-faint")}>
            {system?.controller_reachable ? "함께" : "단독"}
          </div>
        </Card>
      </div>

      <Card>
        <CardTitle>온도 센서</CardTitle>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-2 text-sm">
          {Object.entries(temps).map(([k, v]) => (
            <div key={k} className="flex justify-between border-b border-surface-line py-1">
              <span className="text-ink-soft truncate">{k}</span>
              <span className={cn("font-medium tabular-nums", v >= 70 ? "text-danger" : v >= 55 ? "text-warn" : "")}>
                {v}℃
              </span>
            </div>
          ))}
          {Object.keys(temps).length === 0 && <span className="text-ink-faint">데이터 없음</span>}
        </div>
      </Card>

      <Card>
        <CardTitle>네트워크</CardTitle>
        <div className="text-sm text-ink-soft">
          송신 {net ? (net.tx_bps / 1024).toFixed(1) : "—"} KB/s ·
          수신 {net ? (net.rx_bps / 1024).toFixed(1) : "—"} KB/s
        </div>
      </Card>
    </div>
  );
}
