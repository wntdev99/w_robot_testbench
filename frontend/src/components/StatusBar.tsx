"use client";
import { useTb } from "@/lib/store";
import { cn } from "@/lib/cn";
import { Wifi, WifiOff } from "lucide-react";

function Dot({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-xs text-ink-soft">
      <span className={cn("h-2 w-2 rounded-full", ok ? "bg-ok" : "bg-surface-line")} />
      {label}
    </span>
  );
}

export function StatusBar() {
  const { connected, system, zenoh } = useTb((s) => ({
    connected: s.connected, system: s.system, zenoh: s.zenoh,
  }));
  const z = zenoh ?? system?.zenoh;
  const ctrl = system?.controller_reachable;
  const cpu = system?.cpu_percent;
  const temp = system?.temperatures
    ? Math.max(...Object.values(system.temperatures as Record<string, number>))
    : undefined;

  return (
    <div className="flex items-center gap-4 border-b border-surface-line bg-surface px-5 h-12">
      <span className="flex items-center gap-1.5 text-xs font-medium">
        {connected ? <Wifi size={14} className="text-ok" /> : <WifiOff size={14} className="text-danger" />}
        {connected ? "연결됨" : "연결 끊김"}
      </span>
      <div className="h-4 w-px bg-surface-line" />
      <Dot ok={!!z?.running} label="zenoh" />
      <Dot ok={!!ctrl} label={ctrl ? "201 함께" : "201 단독"} />
      <div className="ml-auto flex items-center gap-4 text-xs text-ink-soft">
        {cpu != null && <span>CPU {cpu.toFixed(0)}%</span>}
        {temp != null && <span>온도 {temp.toFixed(0)}℃</span>}
      </div>
    </div>
  );
}
