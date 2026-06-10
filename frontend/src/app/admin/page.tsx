"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, Play, Plus, Trash2, ArrowUp, ArrowDown, Save } from "lucide-react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { Card, CardTitle } from "@/components/Card";
import { cn } from "@/lib/cn";

type Step = { id: string; label: string; machine: string; kind: string; command: string; delay_s: number };
type Plan = { auto_on_boot: boolean; kill_on_start: boolean; kill_scope: string[]; steps: Step[] };

const STATE_COLOR: Record<string, string> = {
  running: "text-ok", external: "text-brand-600", starting: "text-warn", stopping: "text-warn", failed: "text-danger",
};

export default function AdminPage() {
  const processes = useTb((s) => s.processes);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { api.adminPlan().then(setPlan).catch(() => setMsg("플랜 로드 실패")); }, []);

  const patch = (p: Partial<Plan>) => setPlan((cur) => (cur ? { ...cur, ...p } : cur));
  const patchStep = (i: number, s: Partial<Step>) =>
    setPlan((cur) => cur ? { ...cur, steps: cur.steps.map((st, j) => (j === i ? { ...st, ...s } : st)) } : cur);
  const move = (i: number, d: number) => setPlan((cur) => {
    if (!cur) return cur; const j = i + d; if (j < 0 || j >= cur.steps.length) return cur;
    const steps = [...cur.steps]; [steps[i], steps[j]] = [steps[j], steps[i]]; return { ...cur, steps };
  });
  const addStep = () => setPlan((cur) => cur ? { ...cur, steps: [...cur.steps, { id: `step${Date.now()}`, label: "새 단계", machine: "server", kind: "launch", command: "", delay_s: 2 }] } : cur);
  const removeStep = (i: number) => setPlan((cur) => cur ? { ...cur, steps: cur.steps.filter((_, j) => j !== i) } : cur);
  const toggleScope = (m: string) => setPlan((cur) => {
    if (!cur) return cur; const has = cur.kill_scope.includes(m);
    return { ...cur, kill_scope: has ? cur.kill_scope.filter((x) => x !== m) : [...cur.kill_scope, m] };
  });

  const save = async () => { if (!plan) return; setBusy(true); try { await api.adminSavePlan(plan); setMsg("저장됨 ✓"); } catch (e) { setMsg(String(e)); } finally { setBusy(false); } };
  const apply = async () => {
    if (!plan) return;
    if (!window.confirm("기존 모든 ros2 프로세스를 종료하고 시작 플랜을 실행합니다.\n(control.launch 등은 모터 전원 인가 — 안전 공간 확인)\n계속할까요?")) return;
    setBusy(true);
    try { await api.adminSavePlan(plan); await api.adminApply(); setMsg("적용 시작 — 종료 후 순서대로 기동 중…"); } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  };
  const killOnly = async () => {
    if (!plan) return;
    if (!window.confirm(`${plan.kill_scope.join(", ")} 의 ros2 프로세스를 모두 종료합니다. 계속?`)) return;
    setBusy(true);
    try { await api.adminKill(plan.kill_scope); setMsg("종료 요청 전송"); } catch (e) { setMsg(String(e)); } finally { setBusy(false); }
  };

  if (!plan) return <div className="text-sm text-ink-faint">{msg || "로딩…"}</div>;

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold">관리자 — 시작 플랜</h1>

      <div className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 p-3 text-sm">
        <AlertTriangle size={18} className="mt-0.5 shrink-0 text-danger" />
        <div className="text-ink-soft">
          <b className="text-danger">파괴적 동작</b> — ‘적용’은 <b>서버(202){plan.kill_scope.includes("controller") && " + 컨트롤러(201)"}의 모든 ros2 프로세스를 종료</b>한 뒤
          zenoh 라우터 확인·기동 → 아래 단계를 순서·간격대로 기동합니다. 모터 런치 포함 시 로봇이 동작할 수 있습니다.
        </div>
      </div>

      <Card>
        <CardTitle>옵션</CardTitle>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="checkbox" checked={plan.auto_on_boot} onChange={(e) => patch({ auto_on_boot: e.target.checked })} /> 서버 기동 시 자동 실행 (auto_on_boot)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={plan.kill_on_start} onChange={(e) => patch({ kill_on_start: e.target.checked })} /> 시작 전 기존 ros2 종료 (clean slate)</label>
          <div className="flex items-center gap-3 pl-6 text-xs text-ink-soft">
            종료 대상:
            {["server", "controller"].map((m) => (
              <label key={m} className="flex items-center gap-1"><input type="checkbox" checked={plan.kill_scope.includes(m)} onChange={() => toggleScope(m)} /> {m === "server" ? "서버(202)" : "컨트롤러(201)"}</label>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="mb-3 flex items-center justify-between">
          <CardTitle>실행 단계 (순서 · 간격)</CardTitle>
          <button onClick={addStep} className="flex items-center gap-1 rounded-lg bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700"><Plus size={13} /> 단계 추가</button>
        </div>
        <div className="space-y-2">
          {plan.steps.map((st, i) => (
            <div key={i} className="rounded-xl border border-surface-line p-2.5">
              <div className="mb-1.5 flex items-center gap-2">
                <span className="text-xs text-ink-faint w-5 text-center">{i + 1}</span>
                <input value={st.label} onChange={(e) => patchStep(i, { label: e.target.value })} className="flex-1 rounded border border-surface-line px-2 py-1 text-sm font-medium" placeholder="라벨" />
                <select value={st.machine} onChange={(e) => patchStep(i, { machine: e.target.value })} className="rounded border border-surface-line px-1.5 py-1 text-xs">
                  <option value="server">서버</option><option value="controller">201</option>
                </select>
                <select value={st.kind} onChange={(e) => patchStep(i, { kind: e.target.value })} className="rounded border border-surface-line px-1.5 py-1 text-xs">
                  <option value="launch">launch</option><option value="node">node</option><option value="zenoh">zenoh</option>
                </select>
                <label className="flex items-center gap-1 text-xs text-ink-soft">대기 <input type="number" min={0} step={0.5} value={st.delay_s} onChange={(e) => patchStep(i, { delay_s: Number(e.target.value) })} className="w-14 rounded border border-surface-line px-1 py-1" />s</label>
                <button onClick={() => move(i, -1)} className="rounded p-1 text-ink-faint hover:bg-surface-muted"><ArrowUp size={14} /></button>
                <button onClick={() => move(i, 1)} className="rounded p-1 text-ink-faint hover:bg-surface-muted"><ArrowDown size={14} /></button>
                <button onClick={() => removeStep(i)} className="rounded p-1 text-danger hover:bg-danger/10"><Trash2 size={14} /></button>
              </div>
              <input value={st.command} onChange={(e) => patchStep(i, { command: e.target.value })} className="w-full rounded border border-surface-line px-2 py-1 font-mono text-xs" placeholder="ros2 launch …" disabled={st.kind === "zenoh"} />
            </div>
          ))}
        </div>
      </Card>

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy} className="flex items-center gap-1.5 rounded-xl bg-surface-muted px-4 py-2 text-sm font-medium hover:bg-surface-line disabled:opacity-50"><Save size={15} /> 저장</button>
        <button onClick={killOnly} disabled={busy} className="rounded-xl bg-danger/10 px-4 py-2 text-sm font-medium text-danger disabled:opacity-50">기존 ros2 종료만</button>
        <button onClick={apply} disabled={busy} className="flex items-center gap-1.5 rounded-xl bg-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"><Play size={15} /> 저장 후 적용(종료→기동)</button>
        {msg && <span className="text-sm text-ink-soft">{msg}</span>}
      </div>

      <Card>
        <CardTitle>현재 관리 중 프로세스</CardTitle>
        <div className="space-y-1 text-sm">
          {processes.length === 0 && <span className="text-ink-faint">없음</span>}
          {processes.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border-b border-surface-line py-1.5">
              <span className={cn("w-16 text-xs font-medium", STATE_COLOR[r.state] ?? "text-ink-faint")}>{r.state}</span>
              <span className="font-mono text-xs text-ink-soft">{r.proc_id}</span>
              <span className="ml-auto text-xs text-ink-faint">{r.machine}{r.pid ? ` · pid ${r.pid}` : ""}</span>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
