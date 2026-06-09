"use client";
import { useEffect, useRef, useState } from "react";
import { RefreshCw, Plus, LineChart, Settings2, Gauge, Wrench, Rocket, Gamepad2 } from "lucide-react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { cn } from "@/lib/cn";
import {
  Panel, PanelType, Topic,
  PlotWidget, ControllersWidget, DiagnosticsWidget, CommandWidget, LaunchWidget, TeleopWidget,
} from "@/components/panels";

let _pid = 0;
const nextId = () => `w${++_pid}`;

const ADD_MENU: { type: PanelType; label: string; icon: any }[] = [
  { type: "plot", label: "플롯", icon: LineChart },
  { type: "teleop", label: "텔레옵", icon: Gamepad2 },
  { type: "command", label: "명령", icon: Wrench },
  { type: "launch", label: "런치", icon: Rocket },
  { type: "controllers", label: "컨트롤러", icon: Settings2 },
  { type: "diagnostics", label: "Diagnostics", icon: Gauge },
];

export default function WorkspacePage() {
  const subscribe = useTb((s) => s.subscribe);
  const unsubscribe = useTb((s) => s.unsubscribe);

  const [topics, setTopics] = useState<Topic[]>([]);
  const [onlyPlottable, setOnlyPlottable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [cols, setCols] = useState(2);
  const [addOpen, setAddOpen] = useState(false);
  const [panels, setPanels] = useState<Panel[]>([
    { id: nextId(), type: "plot", topic: "", chosen: [] },
    { id: nextId(), type: "command", cmdTopic: "" },
  ]);

  const refresh = async () => {
    setLoading(true);
    try { setTopics(await api.topics(false)); } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); }, []);
  const typeOf = (t: string) => topics.find((x) => x.topic === t)?.types[0];

  // 구독 합집합 — plot 패널의 topic 만 대상
  const subbed = useRef<Set<string>>(new Set());
  useEffect(() => {
    const needed = new Set(panels.filter((p) => p.type === "plot" && p.topic).map((p) => p.topic!));
    needed.forEach((t) => { if (!subbed.current.has(t)) { subscribe(t, typeOf(t)); subbed.current.add(t); } });
    [...subbed.current].forEach((t) => { if (!needed.has(t)) { unsubscribe(t); subbed.current.delete(t); } });
  }, [panels, topics]); // eslint-disable-line
  useEffect(() => () => { subbed.current.forEach((t) => unsubscribe(t)); }, []); // eslint-disable-line

  const update = (id: string, patch: Partial<Panel>) =>
    setPanels((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = (type: PanelType) => {
    setPanels((ps) => [...ps, { id: nextId(), type, topic: "", chosen: [], cmdTopic: "" }]);
    setAddOpen(false);
  };
  const remove = (id: string) => setPanels((ps) => ps.filter((p) => p.id !== id));

  const visible = topics.filter((t) => (onlyPlottable ? t.plottable : true));
  const canRemove = panels.length > 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">워크스페이스</h1>
          <p className="text-xs text-ink-faint">플롯 · 컨트롤러 · 모터진단 · 명령을 한 화면에서 — 제어하고 반응을 바로 본다</p>
        </div>
        <div className="flex items-center gap-3 text-xs text-ink-soft">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={onlyPlottable} onChange={(e) => setOnlyPlottable(e.target.checked)} /> 플롯 가능만
          </label>
          <select value={cols} onChange={(e) => setCols(Number(e.target.value))} className="rounded-lg border border-surface-line bg-surface px-2 py-1">
            <option value={1}>1열</option><option value={2}>2열</option><option value={3}>3열</option>
          </select>
          <button onClick={refresh} className="flex items-center gap-1.5 rounded-lg bg-surface-muted px-3 py-1.5 font-medium hover:bg-surface-line">
            <RefreshCw size={13} className={cn(loading && "animate-spin")} /> 새로고침
          </button>
          <div className="relative">
            <button onClick={() => setAddOpen((o) => !o)} className="flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 font-medium text-brand-700">
              <Plus size={14} /> 패널 추가
            </button>
            {addOpen && (
              <div className="absolute right-0 z-10 mt-1 w-40 rounded-xl border border-surface-line bg-surface shadow-card p-1">
                {ADD_MENU.map(({ type, label, icon: Icon }) => (
                  <button key={type} onClick={() => add(type)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-soft hover:bg-surface-muted">
                    <Icon size={15} /> {label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className={cn("grid gap-4", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 xl:grid-cols-3")}>
        {panels.map((p) => {
          const common = { panel: p, onRemove: () => remove(p.id), canRemove };
          if (p.type === "plot")
            return <PlotWidget key={p.id} {...common} topics={visible} typeOf={typeOf} onChange={(patch) => update(p.id, patch)} />;
          if (p.type === "command")
            return <CommandWidget key={p.id} {...common} topics={topics} typeOf={typeOf} onChange={(patch) => update(p.id, patch)} />;
          if (p.type === "launch") return <LaunchWidget key={p.id} {...common} />;
          if (p.type === "teleop") return <TeleopWidget key={p.id} {...common} onChange={(patch) => update(p.id, patch)} />;
          if (p.type === "controllers") return <ControllersWidget key={p.id} {...common} />;
          return <DiagnosticsWidget key={p.id} {...common} onChange={(patch) => update(p.id, patch)} />;
        })}
      </div>
    </div>
  );
}
