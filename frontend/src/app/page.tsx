"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LayoutGrid, Cpu, Server, Activity, Save, Circle } from "lucide-react";
import { api, recordingDownloadUrl } from "@/lib/api";
import { useTb } from "@/lib/store";
import { Card, CardTitle } from "@/components/Card";
import { cn } from "@/lib/cn";

const STATE_COLOR: Record<string, string> = {
  running: "text-ok", external: "text-brand-600", starting: "text-warn", stopping: "text-warn", failed: "text-danger",
};

function Stat({ ok, label, value }: { ok: boolean; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-surface px-3 py-2 shadow-card border border-surface-line">
      <span className={cn("h-2.5 w-2.5 rounded-full", ok ? "bg-ok" : "bg-surface-line")} />
      <div>
        <div className="text-xs text-ink-faint">{label}</div>
        <div className="text-sm font-semibold">{value}</div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const system = useTb((s) => s.system);
  const estop = useTb((s) => s.estop);
  const processes = useTb((s) => s.processes);

  const [profiles, setProfiles] = useState<any[]>([]);
  const [snaps, setSnaps] = useState<{ name: string; updated: number }[]>([]);
  const [recs, setRecs] = useState<{ file: string; rows: number | null }[]>([]);

  const loadProfiles = () => api.profiles().then(setProfiles).catch(() => {});
  useEffect(() => {
    loadProfiles();
    api.snapshots().then(setSnaps).catch(() => {});
    api.recordings().then(setRecs).catch(() => {});
  }, []);

  const zenoh = system?.zenoh;
  const ctrlReach = system?.controller_reachable;
  const temps = (system?.temperatures ?? {}) as Record<string, number>;
  const maxTemp = Object.keys(temps).length ? Math.max(...Object.values(temps)) : undefined;
  const ctrlMs = system?.latency?.controller_ms;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-xl font-bold">안녕하세요 👋</h1>
          <p className="text-sm text-ink-faint">로봇 상태를 한눈에 확인하고 작업을 시작하세요.</p>
        </div>
        <Link href="/workspace/" className="flex items-center gap-2 rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white shadow-card">
          <LayoutGrid size={16} /> 워크스페이스 열기
        </Link>
      </div>

      {/* 전체 상태 요약 */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat ok={!!zenoh?.running} label="zenoh 라우터" value={zenoh?.running ? "ON" : "OFF"} />
        <Stat ok={!!ctrlReach} label="컨트롤러 201" value={ctrlReach ? "함께" : "단독"} />
        <Stat ok={!!system?.internet} label="인터넷" value={system?.internet ? "정상" : "끊김"} />
        <Stat ok={!estop} label="비상정지" value={estop ? "발동됨" : "정상"} />
      </div>

      {/* 머신 카드 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardTitle><span className="inline-flex items-center gap-1.5"><Server size={14} /> 서버 (202)</span></CardTitle>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div><div className="text-2xl font-bold">{system?.cpu_percent?.toFixed(0) ?? "—"}%</div><div className="text-xs text-ink-faint">CPU</div></div>
            <div><div className="text-2xl font-bold">{system?.mem?.percent ?? "—"}%</div><div className="text-xs text-ink-faint">메모리</div></div>
            <div><div className={cn("text-2xl font-bold", maxTemp != null && maxTemp >= 70 ? "text-danger" : maxTemp != null && maxTemp >= 55 ? "text-warn" : "")}>{maxTemp != null ? `${maxTemp.toFixed(0)}℃` : "—"}</div><div className="text-xs text-ink-faint">최고온도</div></div>
          </div>
          <div className="mt-2 text-center text-xs text-ink-faint">
            ↓{system ? (system.net?.rx_bps / 1024).toFixed(0) : "—"} ↑{system ? (system.net?.tx_bps / 1024).toFixed(0) : "—"} KB/s
          </div>
        </Card>
        <Card>
          <CardTitle><span className="inline-flex items-center gap-1.5"><Cpu size={14} /> 컨트롤러 (201)</span></CardTitle>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div><div className={cn("text-2xl font-bold", ctrlReach ? "text-ok" : "text-ink-faint")}>{ctrlReach ? "함께" : "단독"}</div><div className="text-xs text-ink-faint">연결</div></div>
            <div><div className="text-2xl font-bold">{ctrlMs != null ? `${ctrlMs.toFixed(1)}` : "—"}</div><div className="text-xs text-ink-faint">지연 ms</div></div>
          </div>
          <div className="mt-2 text-center text-xs text-ink-faint">192.168.34.201 · CPU/메모리는 미수집</div>
        </Card>
      </div>

      {/* 실행 중 프로세스 (testbench 관리) */}
      <Card>
        <CardTitle><span className="inline-flex items-center gap-1.5"><Activity size={14} /> 실행 중 프로세스 <span className="text-xs font-normal text-ink-faint">(testbench 관리)</span></span></CardTitle>
        <div className="mt-1 space-y-1 text-sm">
          {processes.length === 0 && <span className="text-xs text-ink-faint">testbench가 기동·관리 중인 프로세스 없음 (시작 플랜·런치 패널·프로파일로 기동)</span>}
          {processes.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-surface-line py-1.5 last:border-0">
              <span className={cn("w-16 text-xs font-medium", STATE_COLOR[r.state] ?? "text-ink-faint")}>{r.state}</span>
              <span className="truncate font-mono text-xs text-ink-soft">{r.proc_id}</span>
              <span className="ml-auto whitespace-nowrap text-xs text-ink-faint"><b className="text-brand-700">{r.machine === "controller" ? "201" : "202"}</b>{r.pid ? ` · pid ${r.pid}` : ""}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* 빠른 진입 */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card>
          <CardTitle><span className="inline-flex items-center gap-1.5"><Save size={14} /> 저장된 테스트 구성 (스냅샷)</span></CardTitle>
          <div className="space-y-1.5">
            {snaps.length === 0 && <div className="text-sm text-ink-faint">저장된 스냅샷 없음 — 워크스페이스에서 구성 후 저장하세요</div>}
            {snaps.map((s) => (
              <Link key={s.name} href={`/workspace/?snapshot=${encodeURIComponent(s.name)}`}
                className="flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2 text-sm hover:bg-surface-line">
                <span className="font-medium">{s.name}</span>
                <span className="text-xs text-brand-700">이 구성으로 열기 →</span>
              </Link>
            ))}
          </div>
        </Card>

        <Card>
          <CardTitle>프로파일 (런치 묶음)</CardTitle>
          <div className="space-y-1.5">
            {profiles.map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded-xl bg-surface-muted px-3 py-2">
                <div><div className="text-sm font-medium">{p.label}</div><div className="text-xs text-ink-faint">{p.persistent ? "필수(자동기동)" : p.exclusive ? "단독 실행" : ""}</div></div>
                {p.persistent
                  ? <span className={cn("text-xs font-medium", p.up ? "text-ok" : "text-ink-faint")}>{p.up ? "실행 중" : "대기"}</span>
                  : <button onClick={() => (p.up ? api.profileDown(p.id) : api.profileUp(p.id)).then(loadProfiles)}
                      className={cn("rounded-lg px-3 py-1 text-xs font-medium", p.up ? "bg-danger/10 text-danger" : "bg-brand-50 text-brand-700")}>
                      {p.up ? "■ 종료" : "▶ 기동"}
                    </button>}
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* 최근 녹화 */}
      {recs.length > 0 && (
        <Card>
          <CardTitle><span className="inline-flex items-center gap-1.5"><Circle size={12} /> 최근 녹화</span></CardTitle>
          <div className="space-y-1">
            {recs.slice(0, 5).map((r) => (
              <div key={r.file} className="flex items-center gap-2 text-xs">
                <span className="min-w-0 flex-1 truncate">{r.file}</span>
                {r.rows != null && <span className="text-ink-faint">{r.rows}행</span>}
                <a className="text-brand-700 underline" href={recordingDownloadUrl(r.file)}>CSV</a>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
