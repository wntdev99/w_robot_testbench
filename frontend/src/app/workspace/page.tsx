"use client";
import { Suspense, useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { RefreshCw, Plus, LineChart, Settings2, Gauge, Wrench, Rocket, Gamepad2, Save, Circle, Camera, Map } from "lucide-react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { cn } from "@/lib/cn";
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, arrayMove } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Panel, PanelType, Topic, SortableHandleContext,
  PlotWidget, ControllersWidget, DiagnosticsWidget, CommandWidget, LaunchWidget, TeleopWidget, RecorderWidget, CameraWidget, NavWidget,
} from "@/components/panels";

let _pid = 0;
const nextId = () => `w${++_pid}`;

// 드래그로 순서 재배치되는 패널 래퍼 — 그립 핸들만 끌림(패널 내부 인터랙션 보호)
function SortablePanel({ id, children }: { id: string; children: React.ReactNode }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id });
  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform), transition,
    zIndex: isDragging ? 50 : undefined, opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      <SortableHandleContext.Provider value={{ setActivatorNodeRef, attributes, listeners }}>
        {children}
      </SortableHandleContext.Provider>
    </div>
  );
}

// 실행 중 런치 바 (서버 202 + 컨트롤러 201) — 진입 시 1회 로드 + 수동 새로고침(SSH 스캔은 버튼으로)
function RunningBar() {
  const [server, setServer] = useState<{ package: string; file: string; pid: number | null }[]>([]);
  const [ctrl, setCtrl] = useState<{ package: string; file: string; pid: number | null }[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const load = async () => {
    setLoading(true);
    const [s, c] = await Promise.all([
      api.runningLaunches("server").catch(() => []),
      api.runningLaunches("controller").catch(() => []),
    ]);
    setServer(s); setCtrl(c); setLoading(false); setLoaded(true);
  };
  useEffect(() => { load(); }, []);
  const chip = (m: string, l: any, i: number) => (
    <span key={m + i} className="rounded-md border border-surface-line bg-surface-muted px-2 py-0.5 text-xs">
      <b className="text-brand-700">{m}</b> {l.package}/{l.file}{l.pid ? <span className="text-ink-faint"> ·{l.pid}</span> : ""}
    </span>
  );
  const none = loaded && server.length === 0 && ctrl.length === 0;
  return (
    <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-surface-line bg-surface px-4 py-2 shadow-card">
      <span className="text-xs font-semibold text-ink-faint">실행 중 런치</span>
      <button onClick={load} disabled={loading}
        className="flex items-center gap-1 rounded-md bg-surface-muted px-2 py-0.5 text-xs font-medium text-ink-soft hover:bg-surface-line disabled:opacity-50">
        <RefreshCw size={12} className={cn(loading && "animate-spin")} /> {loading ? "확인 중…" : "파악"}
      </button>
      {!loaded && !loading && <span className="text-xs text-ink-faint">‘파악’을 눌러 확인</span>}
      {none && <span className="text-xs text-ink-faint">실행 중 ros2 launch 없음</span>}
      {server.map((l, i) => chip("202", l, i))}
      {ctrl.map((l, i) => chip("201", l, i))}
    </div>
  );
}

const ADD_MENU: { type: PanelType; label: string; icon: any }[] = [
  { type: "plot", label: "플롯", icon: LineChart },
  { type: "nav", label: "네비게이션", icon: Map },
  { type: "camera", label: "카메라", icon: Camera },
  { type: "recorder", label: "녹화", icon: Circle },
  { type: "teleop", label: "텔레옵", icon: Gamepad2 },
  { type: "command", label: "명령", icon: Wrench },
  { type: "launch", label: "런치", icon: Rocket },
  { type: "controllers", label: "컨트롤러", icon: Settings2 },
  { type: "diagnostics", label: "Diagnostics", icon: Gauge },
];

export default function WorkspacePage() {
  return <Suspense fallback={null}><WorkspaceInner /></Suspense>;
}

function WorkspaceInner() {
  const subscribe = useTb((s) => s.subscribe);
  const unsubscribe = useTb((s) => s.unsubscribe);

  const [topics, setTopics] = useState<Topic[]>([]);
  const [onlyPlottable, setOnlyPlottable] = useState(true);
  const [loading, setLoading] = useState(false);
  const [cols, setCols] = useState(2);
  const [addOpen, setAddOpen] = useState(false);
  const [ghostOpen, setGhostOpen] = useState(false);  // 그리드 끝 '다음 패널' 고스트
  const [panels, setPanels] = useState<Panel[]>([]);  // 초기엔 빈 워크스페이스

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

  // 드래그 재배치
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
  const onDragEnd = (e: DragEndEvent) => {
    const { active, over } = e;
    if (over && active.id !== over.id) {
      setPanels((ps) => {
        const oldI = ps.findIndex((p) => p.id === active.id);
        const newI = ps.findIndex((p) => p.id === over.id);
        return oldI < 0 || newI < 0 ? ps : arrayMove(ps, oldI, newI);
      });
    }
  };

  const update = (id: string, patch: Partial<Panel>) =>
    setPanels((ps) => ps.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  const add = (type: PanelType) => {
    setPanels((ps) => [...ps, { id: nextId(), type, topic: "", chosen: [], cmdTopic: "" }]);
    setAddOpen(false);
  };
  const remove = (id: string) => setPanels((ps) => ps.filter((p) => p.id !== id));

  // ── 스냅샷 저장/복원 ──
  const searchParams = useSearchParams();
  const snapParam = searchParams.get("snapshot");   // 현재 불러온 스냅샷 이름
  const [snaps, setSnaps] = useState<{ name: string; updated: number }[]>([]);
  const [saveOpen, setSaveOpen] = useState(false);
  const [snapName, setSnapName] = useState("");
  const loadSnaps = () => api.snapshots().then(setSnaps).catch(() => {});
  useEffect(() => { loadSnaps(); }, []);
  const openSave = () => { setSnapName(snapParam || ""); setSaveOpen(true); };  // 현재 스냅샷명 prefill
  const confirmSave = async () => {
    const name = snapName.trim();
    if (!name) return;
    await api.saveSnapshot(name, { cols, panels }).catch(() => {});
    setSaveOpen(false);
    loadSnaps();
  };
  const loadSnap = async (name: string) => {
    if (!name) return;
    try {
      const doc = await api.loadSnapshot(name);
      const d = doc.data || {};
      if (typeof d.cols === "number") setCols(d.cols);
      // id 재발급(중복 방지)
      setPanels((d.panels || []).map((p: Panel) => ({ ...p, id: nextId() })));
    } catch { /* */ }
  };
  const deleteSnap = async (name: string) => {
    if (!name || !window.confirm(`스냅샷 '${name}' 삭제?`)) return;
    await api.deleteSnapshot(name).catch(() => {});
    loadSnaps();
  };
  // ?snapshot=이름 진입/변경 시 자동 복원 (사이드바·대시보드에서 클릭 시, 마운트 유지 중에도 반영)
  useEffect(() => {
    if (snapParam) loadSnap(snapParam);     // 스냅샷 클릭 → 해당 구성 복원
    else setPanels([]);                     // 스냅샷 없이 워크스페이스 진입 → 초기 빈 화면
  }, [snapParam]); // eslint-disable-line

  const visible = topics.filter((t) => (onlyPlottable ? t.plottable : true));
  const canRemove = true;  // 빈 워크스페이스 허용 → 단일 패널도 제거 가능

  return (
    <div className="space-y-4">
      <RunningBar />
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
          {/* 스냅샷 */}
          <div className="flex items-center gap-1 border-l border-surface-line pl-3">
            <select value="" onChange={(e) => loadSnap(e.target.value)}
              className="rounded-lg border border-surface-line bg-surface px-2 py-1.5">
              <option value="">스냅샷 불러오기…</option>
              {snaps.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
            </select>
            <button onClick={openSave} title={snapParam ? `'${snapParam}' 덮어쓰기 또는 새 이름으로 저장` : "현재 구성 저장"}
              className="flex items-center gap-1 rounded-lg bg-surface-muted px-2 py-1.5 font-medium hover:bg-surface-line">
              <Save size={13} /> {snapParam ? "저장(덮어쓰기)" : "저장"}
            </button>
            {snaps.length > 0 && (
              <select value="" onChange={(e) => deleteSnap(e.target.value)} title="스냅샷 삭제"
                className="rounded-lg border border-surface-line bg-surface px-1.5 py-1.5 text-ink-faint">
                <option value="">🗑</option>
                {snaps.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
              </select>
            )}
          </div>
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

      {panels.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-surface-line py-20 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-3xl font-light text-brand-600">+</div>
          <div className="mt-3 text-sm text-ink-faint">패널을 추가해 워크스페이스를 구성하세요</div>
          <div className="mt-5 flex max-w-lg flex-wrap justify-center gap-2">
            {ADD_MENU.map(({ type, label, icon: Icon }) => (
              <button key={type} onClick={() => add(type)}
                className="flex items-center gap-1.5 rounded-xl border border-surface-line bg-surface px-3 py-2 text-sm text-ink-soft shadow-card hover:bg-surface-muted">
                <Icon size={15} /> {label}
              </button>
            ))}
          </div>
        </div>
      ) : (
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={panels.map((p) => p.id)} strategy={rectSortingStrategy}>
          <div className={cn("grid gap-4", cols === 1 ? "grid-cols-1" : cols === 2 ? "grid-cols-1 xl:grid-cols-2" : "grid-cols-1 xl:grid-cols-3")}>
            {panels.map((p) => {
              const common = { panel: p, onRemove: () => remove(p.id), canRemove };
              const widget =
                p.type === "plot" ? <PlotWidget {...common} topics={visible} typeOf={typeOf} onChange={(patch) => update(p.id, patch)} />
                : p.type === "command" ? <CommandWidget {...common} topics={topics} typeOf={typeOf} onChange={(patch) => update(p.id, patch)} />
                : p.type === "launch" ? <LaunchWidget {...common} onChange={(patch) => update(p.id, patch)} />
                : p.type === "recorder" ? <RecorderWidget {...common} topics={visible} />
                : p.type === "camera" ? <CameraWidget {...common} onChange={(patch) => update(p.id, patch)} />
                : p.type === "nav" ? <NavWidget {...common} />
                : p.type === "teleop" ? <TeleopWidget {...common} onChange={(patch) => update(p.id, patch)} />
                : p.type === "controllers" ? <ControllersWidget {...common} />
                : <DiagnosticsWidget {...common} onChange={(patch) => update(p.id, patch)} />;
              return <SortablePanel key={p.id} id={p.id}>{widget}</SortablePanel>;
            })}

            {/* 다음 패널 자리 — 희미한 고스트 추가 카드 */}
            <div className="flex min-h-[140px] items-center justify-center rounded-2xl border-2 border-dashed border-surface-line/70 opacity-60 transition hover:opacity-100">
              {ghostOpen ? (
                <div className="flex flex-wrap justify-center gap-2 p-3">
                  {ADD_MENU.map(({ type, label, icon: Icon }) => (
                    <button key={type} onClick={() => { add(type); setGhostOpen(false); }}
                      className="flex items-center gap-1.5 rounded-lg border border-surface-line bg-surface px-2.5 py-1.5 text-xs text-ink-soft hover:bg-surface-muted">
                      <Icon size={14} /> {label}
                    </button>
                  ))}
                </div>
              ) : (
                <button onClick={() => setGhostOpen(true)} className="flex w-full flex-col items-center gap-1 py-8 text-ink-faint hover:text-ink-soft">
                  <span className="text-3xl font-light">+</span>
                  <span className="text-xs">패널 추가</span>
                </button>
              )}
            </div>
          </div>
        </SortableContext>
      </DndContext>
      )}

      {/* 스냅샷 저장 모달 (Toss풍) */}
      {saveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-ink/30 p-4" onClick={() => setSaveOpen(false)}>
          {(() => {
            const name = snapName.trim();
            const exists = snaps.some((s) => s.name === name);
            return (
          <div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="text-base font-bold">스냅샷 저장</div>
            <p className="mt-1 text-xs text-ink-faint">
              {snapParam ? <>현재 불러온 스냅샷 <b className="text-ink">‘{snapParam}’</b>. 이름 그대로 저장하면 덮어쓰고, 바꾸면 새로 저장합니다.</>
                : "현재 워크스페이스 구성을 이름으로 저장합니다."}
            </p>
            <input
              autoFocus value={snapName}
              onChange={(e) => setSnapName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") confirmSave(); if (e.key === "Escape") setSaveOpen(false); }}
              placeholder="예: 모터 온도 테스트"
              className="mt-4 w-full rounded-xl border border-surface-line px-3 py-2 text-sm outline-none focus:border-brand-500"
            />
            <div className="mt-2 text-xs">
              {name && (exists
                ? <span className="text-warn">기존 ‘{name}’ <b>덮어쓰기</b></span>
                : <span className="text-ok">새 스냅샷 ‘{name}’ 생성</span>)}
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setSaveOpen(false)}
                className="rounded-xl bg-surface-muted px-4 py-2 text-sm font-medium text-ink-soft hover:bg-surface-line">취소</button>
              <button onClick={confirmSave} disabled={!name}
                className="rounded-xl bg-brand-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
                {exists ? "덮어쓰기" : "저장"}
              </button>
            </div>
          </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}
