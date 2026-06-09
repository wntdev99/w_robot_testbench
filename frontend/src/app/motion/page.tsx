"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { Card, CardTitle } from "@/components/Card";
import { cn } from "@/lib/cn";

const MOTORS = [
  { id: "can2:11", label: "조향 FL" }, { id: "can2:12", label: "조향 FR" },
  { id: "can2:13", label: "조향 RL" }, { id: "can2:14", label: "조향 RR" },
];

export default function MotionPage() {
  const diagnostics = useTb((s) => s.diagnostics);
  const [controllers, setControllers] = useState<any[]>([]);
  const [msg, setMsg] = useState("");

  const load = () => api.controllers().then(setControllers).catch((e) => setMsg(String(e)));
  useEffect(() => { load(); }, []);

  const toggle = async (c: any) => {
    const active = c.state === "active";
    try {
      await api.switchController(active ? [] : [c.name], active ? [c.name] : []);
      setMsg(`${c.name} ${active ? "비활성" : "활성"} 요청`);
      setTimeout(load, 500);
    } catch (e) { setMsg(String(e)); }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">모터 · 제어</h1>

      <Card>
        <CardTitle>컨트롤러 (controller_manager)</CardTitle>
        {controllers.length === 0 && <div className="text-sm text-ink-faint">컨트롤러 없음 (로봇/컨트롤러 기동 필요)</div>}
        <div className="space-y-2">
          {controllers.map((c) => (
            <div key={c.name} className="flex items-center justify-between rounded-xl bg-surface-muted px-4 py-2.5">
              <div>
                <div className="text-sm font-medium">{c.name}</div>
                <div className="text-xs text-ink-faint">{c.type}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={cn("text-xs font-medium", c.state === "active" ? "text-ok" : "text-ink-faint")}>
                  {c.state}
                </span>
                {c.name !== "joint_state_broadcaster" && (
                  <button onClick={() => toggle(c)}
                    className="rounded-lg bg-brand-50 px-3 py-1 text-xs font-medium text-brand-700">
                    {c.state === "active" ? "비활성" : "활성"}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
        {msg && <div className="mt-2 text-xs text-ink-faint">{msg}</div>}
      </Card>

      <Card>
        <CardTitle>조향 모터 진단 (/diagnostics)</CardTitle>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-faint border-b border-surface-line">
              <th className="py-1.5">모터</th><th>온도(℃)</th><th>전류(A)</th><th>토크(Nm)</th><th>전압(V)</th><th>fault</th>
            </tr>
          </thead>
          <tbody>
            {MOTORS.map((m) => {
              const d = diagnostics[m.id];
              const temp = d ? Number(d.temperature_C) : null;
              return (
                <tr key={m.id} className="border-b border-surface-line">
                  <td className="py-1.5 font-medium">{m.label}<span className="text-ink-faint"> {m.id}</span></td>
                  <td className={cn("tabular-nums", temp != null && temp >= 60 ? "text-danger" : "")}>{d?.temperature_C ?? "—"}</td>
                  <td className="tabular-nums">{d ? Number(d.current_A).toFixed(3) : "—"}</td>
                  <td className="tabular-nums">{d ? Number(d.effort_Nm).toFixed(3) : "—"}</td>
                  <td className="tabular-nums">{d?.voltage_V ?? "—"}</td>
                  <td className="tabular-nums">{d?.fault_code ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="mt-2 text-xs text-ink-faint">실측 채널: moteus DiagnosticArray (docs/measured-interfaces.md §2.3)</div>
      </Card>
    </div>
  );
}
