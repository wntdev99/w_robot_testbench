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
  // 개별 셀렉터(원시값/안정참조) — 객체 리터럴 반환 시 React18 무한루프 유발하므로 분리
  const connected = useTb((s) => s.connected);
  const system = useTb((s) => s.system);
  const zenoh = useTb((s) => s.zenoh);
  const z = zenoh ?? system?.zenoh;
  const ctrl = system?.controller_reachable;
  const sshOk = system?.controller_ssh_ok;
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
      {ctrl && sshOk === false && (
        <span className="flex items-center gap-1 text-xs font-medium text-danger" title="201에 ping은 되지만 SSH 키 인증 실패 — 원격 런치 기동/종료 불가. scripts/setup_ssh.sh 실행 필요">
          <span className="h-2 w-2 rounded-full bg-danger" /> 201 SSH✗
        </span>
      )}
      <div className="ml-auto flex items-center gap-4 text-xs text-ink-soft">
        {cpu != null && <span>CPU {cpu.toFixed(0)}%</span>}
        {temp != null && <span>온도 {temp.toFixed(0)}℃</span>}
      </div>
    </div>
  );
}
