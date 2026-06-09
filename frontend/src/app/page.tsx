"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { Card, CardTitle } from "@/components/Card";
import { PlotPanel, PlotSample } from "@/components/PlotPanel";
import { cn } from "@/lib/cn";

const MOTORS = [
  { id: "can2:11", label: "조향 FL" },
  { id: "can2:12", label: "조향 FR" },
  { id: "can2:13", label: "조향 RL" },
  { id: "can2:14", label: "조향 RR" },
];

export default function Dashboard() {
  const { system, diagnostics } = useTb((s) => ({ system: s.system, diagnostics: s.diagnostics }));
  const [profiles, setProfiles] = useState<any[]>([]);
  const [temp, setTemp] = useState<PlotSample | null>(null);

  const loadProfiles = () => api.profiles().then(setProfiles).catch(() => {});
  useEffect(() => { loadProfiles(); }, []);

  // 모터 온도 → 플롯 샘플
  useEffect(() => {
    const vals = MOTORS.map((m) => {
      const v = diagnostics[m.id]?.temperature_C;
      return v != null ? Number(v) : null;
    });
    if (vals.some((v) => v != null)) setTemp({ t: Date.now() / 1000, vals });
  }, [diagnostics]);

  const ctrlReach = system?.controller_reachable;
  const cpu = system?.cpu_percent;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold">안녕하세요 👋</h1>
        <p className="text-sm text-ink-faint">로봇 상태를 한눈에 확인하세요.</p>
      </div>

      {/* 상태 카드 */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardTitle>시스템 (202)</CardTitle>
          <div className="text-2xl font-bold">{cpu != null ? `${cpu.toFixed(0)}%` : "—"}</div>
          <div className="text-xs text-ink-faint mt-1">
            CPU · 메모리 {system?.mem?.percent ?? "—"}% · 인터넷 {system?.internet ? "정상" : "끊김"}
          </div>
        </Card>
        <Card>
          <CardTitle>컨트롤러 (201)</CardTitle>
          <div className={cn("text-2xl font-bold", ctrlReach ? "text-ok" : "text-ink-faint")}>
            {ctrlReach ? "함께" : "단독"}
          </div>
          <div className="text-xs text-ink-faint mt-1">192.168.34.201</div>
        </Card>
        <Card>
          <CardTitle>활성 프로파일</CardTitle>
          <div className="text-2xl font-bold">{profiles.filter((p) => p.up).length}</div>
          <div className="text-xs text-ink-faint mt-1">
            {profiles.filter((p) => p.up).map((p) => p.label).join(", ") || "없음"}
          </div>
        </Card>
      </div>

      {/* 빠른 시작 */}
      <Card>
        <CardTitle>빠른 시작</CardTitle>
        <div className="flex flex-wrap gap-2">
          {profiles.filter((p) => !p.persistent).map((p) => (
            <button
              key={p.id}
              onClick={() => (p.up ? api.profileDown(p.id) : api.profileUp(p.id)).then(loadProfiles)}
              className={cn(
                "rounded-xl px-4 py-2 text-sm font-medium transition",
                p.up ? "bg-ok/10 text-ok" : "bg-brand-50 text-brand-700 hover:bg-brand-100",
              )}
            >
              {p.up ? "■ " : "▶ "}{p.label}
            </button>
          ))}
        </div>
      </Card>

      {/* 즐겨찾기 플롯: 모터 온도 */}
      <Card>
        <CardTitle>조향 모터 온도 (실시간)</CardTitle>
        <PlotPanel title="" seriesLabels={MOTORS.map((m) => m.label)} latest={temp} windowSec={60} />
      </Card>
    </div>
  );
}
