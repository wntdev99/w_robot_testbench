"use client";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { X, GripVertical } from "lucide-react";
import { api, recordingDownloadUrl, cameraStreamUrl, navMapUrl } from "@/lib/api";
import { useTb } from "@/lib/store";
import { Card } from "@/components/Card";
import { PlotPanel, PlotSample } from "@/components/PlotPanel";
import { cn } from "@/lib/cn";

export type PanelType = "plot" | "controllers" | "diagnostics" | "command" | "launch" | "teleop" | "recorder" | "camera" | "nav";
export type PlotSource = "topic" | "system";
export type ViewMode = "graph" | "table";
export type Panel = {
  id: string;
  type: PanelType;
  title?: string;
  view?: ViewMode;       // 표/그래프 (plot·diagnostics 패널)
  // plot
  source?: PlotSource;   // 기본 "topic"
  topic?: string;
  msgType?: string;
  chosen?: string[];
  sysCat?: string;       // 시스템 소스 선택 카테고리(cpu/mem/temp/net/conn)
  // diagnostics
  diagAxis?: "device" | "metric";  // 기기별 / 항목별
  diagCat?: string;                // 선택된 카테고리(hardware_id 또는 metric key)
  // command
  cmdTopic?: string;
  // camera
  camTopic?: string;
};

export type Topic = { topic: string; types: string[]; publishers: number; subscribers: number; plottable: boolean };
export type Field = { path: string; base_type: string; array: boolean; plottable: boolean };

const NUMERIC = new Set([
  "float", "double", "float32", "float64", "int8", "uint8", "int16", "uint16",
  "int32", "uint32", "int64", "uint64", "byte", "char", "octet", "boolean", "bool",
]);
export const getPath = (obj: any, path: string) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const num = (v: any): number | null =>
  typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : null;
function setPath(obj: any, path: string, val: any) {
  const ks = path.split("."); let o = obj;
  ks.forEach((k, i) => { if (i === ks.length - 1) o[k] = val; else o = o[k] ?? (o[k] = {}); });
}

// 시스템 스냅샷(plain object)에서 수치/불리언 leaf 경로 추출 (ts 제외)
function systemFields(sys: any): Field[] {
  const out: Field[] = [];
  const walk = (o: any, prefix: string) => {
    for (const [k, v] of Object.entries(o || {})) {
      if (k === "ts") continue;
      const p = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "number") out.push({ path: p, base_type: "double", array: false, plottable: true });
      else if (typeof v === "boolean") out.push({ path: p, base_type: "boolean", array: false, plottable: true });
      else if (v && typeof v === "object" && !Array.isArray(v)) walk(v, p);
    }
  };
  walk(sys, "");
  return out;
}

// 시스템 필드를 카테고리로 묶음 (해당 카테고리 선택 시 전체가 한 차트에)
const SYS_GROUPS: { key: string; label: string; match: (p: string) => boolean }[] = [
  { key: "cpu", label: "CPU", match: (p) => p === "cpu_percent" },
  { key: "mem", label: "메모리", match: (p) => p.startsWith("mem.") },
  { key: "temp", label: "온도", match: (p) => p.startsWith("temperatures.") },
  { key: "net", label: "네트워크(처리량)", match: (p) => p.startsWith("net.") },
  { key: "latency", label: "지연(latency ms)", match: (p) => p.startsWith("latency.") },
  { key: "conn", label: "연결상태", match: (p) => p === "internet" || p === "controller_reachable" || p.startsWith("zenoh.") },
];
function systemCategories(fields: Field[]) {
  return SYS_GROUPS
    .map((g) => ({ key: g.key, label: g.label, paths: fields.filter((f) => g.match(f.path)).map((f) => f.path) }))
    .filter((g) => g.paths.length > 0);
}

// 표/그래프 토글 (모듈 레벨 — 안정 식별자)
function ViewToggle({ view, onChange }: { view: ViewMode; onChange: (v: ViewMode) => void }) {
  return (
    <div className="flex rounded-lg bg-surface-muted p-0.5 text-xs">
      {(["graph", "table"] as ViewMode[]).map((v) => (
        <button key={v} onClick={() => onChange(v)}
          className={cn("rounded-md px-2 py-0.5", view === v ? "bg-surface text-ink shadow-card" : "text-ink-faint")}>
          {v === "graph" ? "그래프" : "표"}
        </button>
      ))}
    </div>
  );
}

const fmt = (v: number | null | undefined) =>
  v == null ? "—" : Number.isInteger(v) ? String(v) : v.toFixed(3);

// 라벨+최신값 표
function ValueTable({ labels, vals, units }: { labels: string[]; vals: (number | null)[]; units?: (string | undefined)[] }) {
  if (labels.length === 0) return <div className="py-6 text-center text-sm text-ink-faint">선택된 항목 없음</div>;
  return (
    <table className="w-full text-sm">
      <tbody>
        {labels.map((l, i) => (
          <tr key={l} className="border-b border-surface-line">
            <td className="py-1 text-ink-soft">{l}</td>
            <td className="py-1 text-right font-mono tabular-nums">{fmt(vals[i])}{units?.[i] ? ` ${units[i]}` : ""}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// 뷰 렌더 (그래프 or 표)
function DataView({ view, labels, latest, windowSec, height }: {
  view: ViewMode; labels: string[]; latest: PlotSample | null; windowSec: number; height: number;
}) {
  if (view === "table") return <ValueTable labels={labels} vals={latest?.vals ?? labels.map(() => null)} />;
  return <PlotPanel title="" seriesLabels={labels} latest={latest} windowSec={windowSec} height={height} />;
}

// 드래그 핸들 컨텍스트 — 워크스페이스의 SortablePanel 이 제공, Shell 헤더의 그립이 소비
type DragHandle = { setActivatorNodeRef: (el: HTMLElement | null) => void; attributes: any; listeners: any } | null;
export const SortableHandleContext = createContext<DragHandle>(null);

function Shell({ title, onRemove, canRemove, head, children }: {
  title: string; onRemove: () => void; canRemove: boolean; head?: React.ReactNode; children: React.ReactNode;
}) {
  const handle = useContext(SortableHandleContext);
  return (
    <Card className="min-w-0">
      <div className="flex items-center gap-2 mb-3">
        {handle && (
          <button ref={handle.setActivatorNodeRef} {...handle.attributes} {...handle.listeners}
            title="드래그로 이동" className="-ml-1 cursor-grab text-ink-faint hover:text-ink-soft active:cursor-grabbing touch-none">
            <GripVertical size={14} />
          </button>
        )}
        <span className="text-xs font-semibold text-ink-faint uppercase tracking-wide">{title}</span>
        <div className="ml-auto flex items-center gap-2">{head}
          {canRemove && (
            <button onClick={onRemove} className="rounded-lg p-1 text-ink-faint hover:bg-surface-muted" title="패널 삭제">
              <X size={15} />
            </button>
          )}
        </div>
      </div>
      {children}
    </Card>
  );
}

// ── 플롯 위젯 (소스: 토픽 / 시스템) ──
export function PlotWidget({ panel, topics, typeOf, onChange, onRemove, canRemove }: {
  panel: Panel; topics: Topic[]; typeOf: (t: string) => string | undefined;
  onChange: (p: Partial<Panel>) => void; onRemove: () => void; canRemove: boolean;
}) {
  const source = panel.source ?? "topic";
  const system = useTb((s) => s.system);
  const topicSample = useTb((s) => (panel.topic ? s.topicData[panel.topic] : undefined));
  const [topicFields, setTopicFields] = useState<Field[]>([]);
  const chosen = useMemo(() => new Set(panel.chosen ?? []), [panel.chosen]);

  // 토픽 소스: 타입에서 필드 추출
  useEffect(() => {
    let alive = true;
    if (source !== "topic" || !panel.topic) { setTopicFields([]); return; }
    api.topicFields(panel.topic, typeOf(panel.topic)).then((res) => {
      if (!alive) return;
      setTopicFields(res.plottable_fields);
      if (!panel.chosen?.length)
        onChange({ chosen: res.plottable_fields.slice(0, 4).map((f) => f.path), msgType: res.type });
    }).catch(() => alive && setTopicFields([]));
    return () => { alive = false; };
  }, [panel.topic, source]); // eslint-disable-line

  const fields = source === "system" ? systemFields(system) : topicFields;
  const cats = source === "system" ? systemCategories(fields) : [];
  const sample = source === "system"
    ? (system ? { ts: system.ts, values: system } : undefined)
    : topicSample;

  // 시스템 소스: 기본 카테고리(CPU) 1회 설정 → 해당 카테고리 전체를 차트에
  useEffect(() => {
    if (source === "system" && !panel.sysCat && cats.length) {
      const def = cats.find((c) => c.key === "cpu") ?? cats[0];
      onChange({ sysCat: def.key, chosen: def.paths });
    }
  }, [source, cats.length]); // eslint-disable-line

  const pickCategory = (key: string) => {
    const c = cats.find((x) => x.key === key);
    onChange({ sysCat: key, chosen: c ? c.paths : [] });
  };

  const toggle = (p: string) => {
    const n = new Set(chosen); n.has(p) ? n.delete(p) : n.add(p); onChange({ chosen: [...n] });
  };
  const { labels, latest } = useMemo(() => {
    const lbls: string[] = []; const vals: (number | null)[] = [];
    // JointState 등: top-level name[] 가 배열 인덱스와 1:1 → 인덱스 대신 이름 라벨
    const nameArr: any = sample?.values?.name;
    for (const f of fields) {
      if (!chosen.has(f.path)) continue;
      const v = sample ? getPath(sample.values, f.path) : undefined;
      if (f.array) {
        const arr = Array.isArray(v) ? v : [];
        const useName = Array.isArray(nameArr) && nameArr.length === arr.length;
        arr.forEach((x, i) => { lbls.push(`${f.path}[${useName ? nameArr[i] : i}]`); vals.push(num(x)); });
      } else { lbls.push(f.path); vals.push(num(v)); }
    }
    return { labels: lbls, latest: sample && lbls.length ? ({ t: sample.ts, vals } as PlotSample) : null };
  }, [fields, chosen, sample]);

  const setSource = (s: PlotSource) => onChange({ source: s, topic: "", chosen: [], msgType: undefined, sysCat: undefined });
  const view = panel.view ?? "graph";
  const windowSec = source === "system" ? 120 : 30;
  // 시스템 소스: 선택된 카테고리의 필드만 칩으로 (전체 나열 방지). 토픽 소스: 전체.
  const chipFields = (() => {
    if (source !== "system" || !panel.sysCat) return fields;
    const paths = new Set(cats.find((c) => c.key === panel.sysCat)?.paths ?? []);
    return fields.filter((f) => paths.has(f.path));
  })();

  return (
    <Shell title="플롯" onRemove={onRemove} canRemove={canRemove}
      head={
        <div className="flex items-center gap-1.5">
          <ViewToggle view={view} onChange={(v) => onChange({ view: v })} />
          {/* 소스 토글 */}
          <div className="flex rounded-lg bg-surface-muted p-0.5 text-xs">
            {(["topic", "system"] as PlotSource[]).map((s) => (
              <button key={s} onClick={() => setSource(s)}
                className={cn("rounded-md px-2 py-0.5", source === s ? "bg-surface text-ink shadow-card" : "text-ink-faint")}>
                {s === "topic" ? "토픽" : "시스템"}
              </button>
            ))}
          </div>
          {source === "topic" ? (
            <select value={panel.topic ?? ""} onChange={(e) => onChange({ topic: e.target.value, msgType: typeOf(e.target.value), chosen: [] })}
              className="rounded-lg border border-surface-line bg-surface px-2 py-1 text-xs max-w-[200px]">
              <option value="">토픽…</option>
              {topics.map((t) => <option key={t.topic} value={t.topic} disabled={t.publishers === 0}>{t.topic}{t.publishers === 0 ? " (no pub)" : ""}</option>)}
            </select>
          ) : (
            <select value={panel.sysCat ?? ""} onChange={(e) => pickCategory(e.target.value)}
              className="rounded-lg border border-surface-line bg-surface px-2 py-1 text-xs">
              <option value="">카테고리…</option>
              {cats.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.paths.length})</option>)}
            </select>
          )}
        </div>
      }>
      {chipFields.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {chipFields.map((f) => (
            <button key={f.path} onClick={() => toggle(f.path)}
              className={cn("rounded-md border px-2 py-0.5 text-xs", chosen.has(f.path) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-surface-line text-ink-soft")}>
              {f.path}{f.array ? "[]" : ""}
            </button>
          ))}
        </div>
      )}
      {source === "system" ? (
        labels.length > 0 ? <DataView view={view} labels={labels} latest={latest} windowSec={windowSec} height={200} />
          : <div className="py-6 text-center text-sm text-ink-faint">{system ? "필드를 선택하세요" : "시스템 데이터 대기…"}</div>
      ) : panel.topic ? (
        labels.length > 0 ? <DataView view={view} labels={labels} latest={latest} windowSec={windowSec} height={200} />
          : fields.length > 0 ? <div className="py-6 text-center text-sm text-ink-faint">데이터 수신 대기…</div>
            : <div className="py-6 text-center text-sm text-warn">플롯 가능한 수치 필드 없음</div>
      ) : <div className="py-6 text-center text-sm text-ink-faint">토픽을 선택하세요</div>}
    </Shell>
  );
}

// ── 컨트롤러 위젯 ──
export function ControllersWidget({ panel, onRemove, canRemove }: { panel: Panel; onRemove: () => void; canRemove: boolean }) {
  const [ctrls, setCtrls] = useState<any[]>([]);
  const [msg, setMsg] = useState("");
  const load = () => api.controllers().then(setCtrls).catch((e) => setMsg(String(e)));
  useEffect(() => { load(); const id = setInterval(load, 3000); return () => clearInterval(id); }, []);
  const toggle = async (c: any) => {
    const active = c.state === "active";
    try { await api.switchController(active ? [] : [c.name], active ? [c.name] : []); setTimeout(load, 400); }
    catch (e) { setMsg(String(e)); }
  };
  return (
    <Shell title="컨트롤러" onRemove={onRemove} canRemove={canRemove}>
      {ctrls.length === 0 && <div className="text-sm text-ink-faint">컨트롤러 없음 (컨트롤러 기동 필요)</div>}
      <div className="space-y-1.5">
        {ctrls.map((c) => (
          <div key={c.name} className="flex items-center justify-between rounded-lg bg-surface-muted px-3 py-2">
            <div><div className="text-sm font-medium">{c.name}</div><div className="text-xs text-ink-faint">{c.type}</div></div>
            <div className="flex items-center gap-2">
              <span className={cn("text-xs font-medium", c.state === "active" ? "text-ok" : "text-ink-faint")}>{c.state}</span>
              {c.name !== "joint_state_broadcaster" &&
                <button onClick={() => toggle(c)} className="rounded-md bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-700">
                  {c.state === "active" ? "비활성" : "활성"}
                </button>}
            </div>
          </div>
        ))}
      </div>
      {msg && <div className="mt-2 text-xs text-ink-faint">{msg}</div>}
    </Shell>
  );
}

// ── Diagnostics 위젯 (/diagnostics, 기기별/항목별 카테고리 + 표/그래프) ──
const HID_LABEL: Record<string, string> = {
  "can2:11": "조향 FL", "can2:12": "조향 FR", "can2:13": "조향 RL", "can2:14": "조향 RR",
};
const hidLabel = (h: string) => (HID_LABEL[h] ? `${HID_LABEL[h]} (${h})` : h);

export function DiagnosticsWidget({ panel, onChange, onRemove, canRemove }: {
  panel: Panel; onChange: (p: Partial<Panel>) => void; onRemove: () => void; canRemove: boolean;
}) {
  const diag = useTb((s) => s.diagnostics);
  const view = panel.view ?? "table";
  const axis = panel.diagAxis ?? "metric";
  const chosen = useMemo(() => new Set(panel.chosen ?? []), [panel.chosen]);

  // 수치 진단 필드: path "<hid> · <key>"
  const fields = useMemo(() => {
    const out: { path: string; hid: string; key: string }[] = [];
    for (const [hid, f] of Object.entries(diag || {})) {
      for (const [k, v] of Object.entries(f as any)) {
        if (k.startsWith("_")) continue;
        if (v != null && v !== "" && !isNaN(Number(v))) out.push({ path: `${hid} · ${k}`, hid, key: k });
      }
    }
    return out;
  }, [diag]);

  // 카테고리(축에 따라): 항목별=metric key, 기기별=hardware_id
  const cats = useMemo(() => {
    const m = new Map<string, { key: string; label: string; paths: string[] }>();
    for (const f of fields) {
      const k = axis === "metric" ? f.key : f.hid;
      const label = axis === "metric" ? f.key : hidLabel(f.hid);
      if (!m.has(k)) m.set(k, { key: k, label, paths: [] });
      m.get(k)!.paths.push(f.path);
    }
    return [...m.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [fields, axis]);

  // 기본 카테고리 선택 (항목별이면 temperature 류 우선)
  useEffect(() => {
    if (!cats.length) return;
    if (!panel.diagCat || !cats.find((c) => c.key === panel.diagCat)) {
      const def = (axis === "metric" && cats.find((c) => c.key.toLowerCase().includes("temp"))) || cats[0];
      onChange({ diagCat: def.key, chosen: def.paths });
    }
  }, [cats, axis]); // eslint-disable-line

  const pickCat = (key: string) => {
    const c = cats.find((x) => x.key === key);
    onChange({ diagCat: key, chosen: c ? c.paths : [] });
  };
  const setAxis = (a: "device" | "metric") => onChange({ diagAxis: a, diagCat: undefined, chosen: [] });
  const toggle = (p: string) => { const n = new Set(chosen); n.has(p) ? n.delete(p) : n.add(p); onChange({ chosen: [...n] }); };

  const chipFields = fields.filter((f) => (axis === "metric" ? f.key : f.hid) === panel.diagCat);
  const chipLabel = (f: { hid: string; key: string }) => (axis === "metric" ? hidLabel(f.hid) : f.key);
  const selected = chipFields.filter((f) => chosen.has(f.path));
  const labels = selected.map(chipLabel);

  const [sample, setSample] = useState<PlotSample | null>(null);
  useEffect(() => {
    const vals = selected.map((f) => { const v = diag[f.hid]?.[f.key]; return v != null && !isNaN(Number(v)) ? Number(v) : null; });
    setSample({ t: Date.now() / 1000, vals });
  }, [diag, panel.chosen, panel.diagCat, axis]); // eslint-disable-line

  return (
    <Shell title="Diagnostics" onRemove={onRemove} canRemove={canRemove}
      head={
        <div className="flex items-center gap-1.5">
          <ViewToggle view={view} onChange={(v) => onChange({ view: v })} />
          <div className="flex rounded-lg bg-surface-muted p-0.5 text-xs">
            {(["metric", "device"] as const).map((a) => (
              <button key={a} onClick={() => setAxis(a)}
                className={cn("rounded-md px-2 py-0.5", axis === a ? "bg-surface text-ink shadow-card" : "text-ink-faint")}>
                {a === "metric" ? "항목별" : "기기별"}
              </button>
            ))}
          </div>
        </div>
      }>
      {fields.length === 0 ? (
        <div className="py-6 text-center text-sm text-ink-faint">/diagnostics 데이터 없음 (드라이버 기동 필요)</div>
      ) : (
        <>
          <select value={panel.diagCat ?? ""} onChange={(e) => pickCat(e.target.value)}
            className="mb-2 w-full rounded-lg border border-surface-line bg-surface px-2 py-1 text-xs">
            <option value="">{axis === "metric" ? "항목 선택…" : "기기 선택…"}</option>
            {cats.map((c) => <option key={c.key} value={c.key}>{c.label} ({c.paths.length})</option>)}
          </select>
          {chipFields.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {chipFields.map((f) => (
                <button key={f.path} onClick={() => toggle(f.path)}
                  className={cn("rounded-md border px-2 py-0.5 text-xs", chosen.has(f.path) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-surface-line text-ink-soft")}>
                  {chipLabel(f)}
                </button>
              ))}
            </div>
          )}
          {labels.length > 0
            ? <DataView view={view} labels={labels} latest={sample} windowSec={120} height={200} />
            : <div className="py-6 text-center text-sm text-ink-faint">항목을 선택하세요</div>}
        </>
      )}
    </Shell>
  );
}

// ── 런치 위젯 (런타임 발견 + 실행/종료 + 프로파일) ──
const STATE_COLOR: Record<string, string> = {
  running: "text-ok", external: "text-brand-600", starting: "text-warn",
  stopping: "text-warn", failed: "text-danger",
};
export function LaunchWidget({ onRemove, canRemove }: { panel: Panel; onRemove: () => void; canRemove: boolean }) {
  const processes = useTb((s) => s.processes);
  const [machine, setMachine] = useState<"server" | "controller">("server");
  const [files, setFiles] = useState<{ package: string; file: string; path: string }[]>([]);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [profiles, setProfiles] = useState<any[]>([]);
  const [msg, setMsg] = useState("");

  const loadFiles = async () => {
    setLoading(true);
    try { setFiles(await api.launchFiles(machine)); } catch { setFiles([]); } finally { setLoading(false); }
  };
  useEffect(() => { loadFiles(); /* eslint-disable-next-line */ }, [machine]);
  const loadProfiles = () => api.profiles().then(setProfiles).catch(() => {});
  useEffect(() => { loadProfiles(); }, []);

  // testbench 가 직접 기동·관리(생명주기 추적) 중인 프로세스 (WS 실시간), 선택 머신 기준
  const mineRunning = processes.filter((p) => p.machine === machine);

  const run = async (f: { package: string; file: string }) => {
    setMsg(`실행 요청: ${f.package} ${f.file}`);
    try { await api.runLaunch(machine, f.package, f.file); } catch (e) { setMsg(String(e)); }
  };
  const stop = async (id: string) => { try { await api.stopProcess(id); } catch (e) { setMsg(String(e)); } };
  const toggleProfile = async (p: any) => {
    try { await (p.up ? api.profileDown(p.id) : api.profileUp(p.id)); loadProfiles(); } catch (e) { setMsg(String(e)); }
  };

  const filtered = files.filter((f) => (f.package + " " + f.file).toLowerCase().includes(q.toLowerCase()));

  return (
    <Shell title="런치" onRemove={onRemove} canRemove={canRemove}
      head={
        <div className="flex rounded-lg bg-surface-muted p-0.5 text-xs">
          {(["server", "controller"] as const).map((m) => (
            <button key={m} onClick={() => setMachine(m)}
              className={cn("rounded-md px-2 py-0.5", machine === m ? "bg-surface text-ink shadow-card" : "text-ink-faint")}>
              {m === "server" ? "서버(202)" : "컨트롤러(201)"}
            </button>
          ))}
        </div>
      }>
      {/* 프로파일 묶음 */}
      {profiles.filter((p) => !p.persistent).length > 0 && (
        <div className="mb-3">
          <div className="mb-1 text-[11px] font-medium text-ink-faint">프로파일(묶음)</div>
          <div className="flex flex-wrap gap-1.5">
            {profiles.filter((p) => !p.persistent).map((p) => (
              <button key={p.id} onClick={() => toggleProfile(p)}
                className={cn("rounded-md px-2 py-1 text-xs font-medium", p.up ? "bg-ok/10 text-ok" : "bg-brand-50 text-brand-700")}>
                {p.up ? "■ " : "▶ "}{p.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 발견된 런치 파일 */}
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`런치 파일 검색 (${filtered.length}/${files.length})`}
        className="mb-2 w-full rounded-lg border border-surface-line px-2 py-1 text-xs" />
      <div className="max-h-48 overflow-auto rounded-lg border border-surface-line divide-y divide-surface-line">
        {loading && <div className="p-2 text-xs text-ink-faint">스캔 중…</div>}
        {!loading && filtered.length === 0 && <div className="p-2 text-xs text-ink-faint">런치 파일 없음</div>}
        {filtered.map((f) => (
          <div key={f.package + "/" + f.file} className="flex items-center gap-2 px-2 py-1.5 text-xs">
            <div className="min-w-0 flex-1 truncate"><span className="text-ink-faint">{f.package}</span> / {f.file}</div>
            <button onClick={() => run(f)} className="shrink-0 rounded bg-brand-50 px-2 py-0.5 font-medium text-brand-700">실행</button>
          </div>
        ))}
      </div>

      {/* 실행 중 프로세스 (testbench 관리, WS 실시간) */}
      <div className="mt-3 mb-1 text-[11px] font-medium text-ink-faint">실행 중 프로세스 ({machine === "server" ? "202" : "201"} · testbench 관리)</div>
      <div className="space-y-1">
        {mineRunning.length === 0 && <div className="text-xs text-ink-faint">관리 중 프로세스 없음</div>}
        {mineRunning.map((p) => (
          <div key={p.id} className="flex items-center gap-2 text-xs">
            <span className={cn("w-14 shrink-0 text-[11px] font-medium", STATE_COLOR[p.state] ?? "text-ink-faint")}>{p.state}</span>
            <span className="min-w-0 flex-1 truncate font-mono text-ink-soft">{p.proc_id}{p.pid ? <span className="text-ink-faint"> ·{p.pid}</span> : ""}</span>
            {p.kind !== "zenoh"
              ? <button onClick={() => stop(p.id)} className="shrink-0 rounded bg-danger/10 px-2 py-0.5 text-danger">종료</button>
              : <span className="shrink-0 text-[10px] text-ink-faint">zenoh</span>}
          </div>
        ))}
      </div>
      {msg && <div className="mt-2 break-all text-xs text-ink-faint">{msg}</div>}
    </Shell>
  );
}

// ── 네비게이션 위젯 (RViz풍 2D: map + scan + footprint + pose, Canvas) ──
type NavMeta = { has_map: boolean; resolution?: number; width?: number; height?: number; origin?: { x: number; y: number } };
type NavView = { s: number; ox: number; oy: number };
export function NavWidget({ onRemove, canRemove }: { panel: Panel; onRemove: () => void; canRemove: boolean }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const metaRef = useRef<NavMeta | null>(null);
  const overlayRef = useRef<any>({ pose: null, footprint: [], scan: [] });
  const viewRef = useRef<NavView>({ s: 1, ox: 0, oy: 0 });
  const fittedRef = useRef(false);
  const [layers, setLayers] = useState({ scan: true, footprint: true, pose: true });
  const layersRef = useRef(layers); layersRef.current = layers;
  const [status, setStatus] = useState("로딩…");
  const [mode, setMode] = useState<null | "initialpose" | "goal">(null);
  const modeRef = useRef(mode); modeRef.current = mode;
  const poseRef = useRef<{ wx: number; wy: number; yaw: number } | null>(null);
  const [msg, setMsg] = useState("");

  const loadMap = () => {
    api.navMeta().then((m) => {
      if (!m.available) { setStatus("nav 의존성 없음(tf2/cv2)"); return; }
      if (!m.has_map) { setStatus("맵 없음 (map_server 미기동)"); metaRef.current = null; return; }
      metaRef.current = m; fittedRef.current = false; setStatus("");
      const img = new Image();
      img.onload = () => { imgRef.current = img; };
      img.src = navMapUrl() + "?t=" + Date.now();
    }).catch(() => setStatus("연결 오류"));
  };

  const fit = () => {
    const cv = canvasRef.current, m = metaRef.current;
    if (!cv || !m?.width) return;
    const s = Math.min(cv.width / m.width!, cv.height / m.height!) * 0.95;
    viewRef.current = { s, ox: (cv.width - m.width! * s) / 2, oy: (cv.height - m.height! * s) / 2 };
    fittedRef.current = true;
  };

  const w2c = (wx: number, wy: number): [number, number] => {
    const m = metaRef.current!, v = viewRef.current;
    const px = (wx - m.origin!.x) / m.resolution!;
    const py = m.height! - (wy - m.origin!.y) / m.resolution!;
    return [v.ox + px * v.s, v.oy + py * v.s];
  };
  const c2w = (cx: number, cy: number): [number, number] => {
    const m = metaRef.current!, v = viewRef.current;
    const px = (cx - v.ox) / v.s, py = (cy - v.oy) / v.s;
    return [px * m.resolution! + m.origin!.x, (m.height! - py) * m.resolution! + m.origin!.y];
  };
  const publishPose = (kind: "initialpose" | "goal", wx: number, wy: number, yaw: number) => {
    const orientation = { x: 0, y: 0, z: Math.sin(yaw / 2), w: Math.cos(yaw / 2) };
    if (kind === "initialpose") {
      const cov = new Array(36).fill(0); cov[0] = 0.25; cov[7] = 0.25; cov[35] = 0.0685;
      api.publish("/initialpose", "geometry_msgs/msg/PoseWithCovarianceStamped",
        { header: { frame_id: "map" }, pose: { pose: { position: { x: wx, y: wy, z: 0 }, orientation }, covariance: cov } })
        .then(() => setMsg(`초기 위치 설정 (${wx.toFixed(2)}, ${wy.toFixed(2)})`)).catch((e) => setMsg(String(e)));
    } else {
      api.publish("/goal_pose", "geometry_msgs/msg/PoseStamped",
        { header: { frame_id: "map" }, pose: { position: { x: wx, y: wy, z: 0 }, orientation } })
        .then(() => setMsg(`목표 전송 (${wx.toFixed(2)}, ${wy.toFixed(2)})`)).catch((e) => setMsg(String(e)));
    }
  };

  const draw = () => {
    const cv = canvasRef.current; if (!cv) return;
    const ctx = cv.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#dee2e6"; ctx.fillRect(0, 0, cv.width, cv.height);
    const m = metaRef.current, img = imgRef.current, v = viewRef.current;
    if (m?.width && img) {
      if (!fittedRef.current) fit();
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, v.ox, v.oy, m.width! * v.s, m.height! * v.s);
      const ov = overlayRef.current, L = layersRef.current;
      if (L.scan && ov.scan) { ctx.fillStyle = "#fa5252"; for (const [x, y] of ov.scan) { const [cx, cy] = w2c(x, y); ctx.fillRect(cx - 1, cy - 1, 2, 2); } }
      if (L.footprint && ov.footprint?.length) {
        ctx.strokeStyle = "#3182f6"; ctx.lineWidth = 2; ctx.beginPath();
        ov.footprint.forEach(([x, y]: number[], i: number) => { const [cx, cy] = w2c(x, y); i ? ctx.lineTo(cx, cy) : ctx.moveTo(cx, cy); });
        ctx.closePath(); ctx.stroke();
      }
      if (L.pose && ov.pose) {
        const p = ov.pose, len = 0.45;
        const [bx, by] = w2c(p.x, p.y);
        const [hx, hy] = w2c(p.x + len * Math.cos(p.yaw), p.y + len * Math.sin(p.yaw));
        ctx.strokeStyle = "#12b886"; ctx.fillStyle = "#12b886"; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
      }
      // 인터랙션 미리보기 화살표
      const pd = poseRef.current;
      if (pd) {
        const col = modeRef.current === "initialpose" ? "#12b886" : "#3182f6";
        const len = 0.5;
        const [bx, by] = w2c(pd.wx, pd.wy);
        const [hx, hy] = w2c(pd.wx + len * Math.cos(pd.yaw), pd.wy + len * Math.sin(pd.yaw));
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(hx, hy); ctx.stroke();
        ctx.beginPath(); ctx.arc(bx, by, 5, 0, Math.PI * 2); ctx.fill();
      }
    }
  };

  useEffect(() => {
    loadMap();
    const cv = canvasRef.current, wrap = wrapRef.current;
    const resize = () => { if (cv && wrap) { cv.width = wrap.clientWidth; cv.height = 340; fittedRef.current = false; } };
    resize();
    const ro = new ResizeObserver(resize); if (wrap) ro.observe(wrap);
    const poll = setInterval(() => { api.navOverlay().then((o) => { overlayRef.current = o; }).catch(() => {}); }, 150);
    // 휠 줌: passive:false 네이티브 리스너로 등록해 preventDefault 가 먹게(페이지 스크롤 방지)
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      if (!cv) return;
      const rect = cv.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      const v = viewRef.current; const f = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      v.ox = mx - (mx - v.ox) * f; v.oy = my - (my - v.oy) * f; v.s *= f;
    };
    cv?.addEventListener("wheel", onWheelNative, { passive: false });
    let raf = 0; const loop = () => { draw(); raf = requestAnimationFrame(loop); }; loop();
    return () => { ro.disconnect(); clearInterval(poll); cancelAnimationFrame(raf); cv?.removeEventListener("wheel", onWheelNative); };
    // eslint-disable-next-line
  }, []);

  // pan/zoom + pose 인터랙션
  const drag = useRef<{ x: number; y: number } | null>(null);
  const canvasXY = (e: React.PointerEvent): [number, number] => {
    const r = canvasRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture(e.pointerId);
    if (modeRef.current && metaRef.current?.has_map) {
      const [cx, cy] = canvasXY(e); const [wx, wy] = c2w(cx, cy);
      poseRef.current = { wx, wy, yaw: 0 };
    } else {
      drag.current = { x: e.clientX, y: e.clientY };
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (poseRef.current) {
      const [cx, cy] = canvasXY(e); const [wx, wy] = c2w(cx, cy);
      poseRef.current.yaw = Math.atan2(wy - poseRef.current.wy, wx - poseRef.current.wx);
      return;
    }
    if (!drag.current) return;
    const v = viewRef.current; v.ox += e.clientX - drag.current.x; v.oy += e.clientY - drag.current.y;
    drag.current = { x: e.clientX, y: e.clientY };
  };
  const onUp = () => {
    if (poseRef.current) {
      const { wx, wy, yaw } = poseRef.current;
      publishPose(modeRef.current!, wx, wy, yaw);
      poseRef.current = null; setMode(null);
    }
    drag.current = null;
  };

  const toggle = (k: keyof typeof layers) => setLayers((l) => ({ ...l, [k]: !l[k] }));

  return (
    <Shell title="네비게이션" onRemove={onRemove} canRemove={canRemove}
      head={
        <div className="flex items-center gap-2 text-xs">
          <button onClick={() => setMode((m) => (m === "initialpose" ? null : "initialpose"))}
            className={cn("rounded px-2 py-0.5 font-medium", mode === "initialpose" ? "bg-ok text-white" : "bg-ok/10 text-ok")}>2D Pose</button>
          <button onClick={() => setMode((m) => (m === "goal" ? null : "goal"))}
            className={cn("rounded px-2 py-0.5 font-medium", mode === "goal" ? "bg-brand-500 text-white" : "bg-brand-50 text-brand-700")}>Nav Goal</button>
          <button onClick={() => api.navCancel().then((r) => { const n = Object.values(r).reduce((s: number, v: any) => s + (v?.cancelled || 0), 0); setMsg(`주행 취소 (${n}건)`); }).catch((e) => setMsg(String(e)))}
            className="rounded bg-danger/10 px-2 py-0.5 font-medium text-danger">주행취소</button>
          <span className="h-3 w-px bg-surface-line" />
          {(["scan", "footprint", "pose"] as const).map((k) => (
            <label key={k} className="flex items-center gap-1 text-ink-soft">
              <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} /> {k}
            </label>
          ))}
          <button onClick={() => { loadMap(); fittedRef.current = false; }} className="rounded bg-surface-muted px-2 py-0.5 hover:bg-surface-line">맵</button>
        </div>
      }>
      <div ref={wrapRef} className="relative w-full">
        {status && <div className="absolute z-10 m-2 rounded bg-surface/80 px-2 py-1 text-xs text-ink-faint">{status}</div>}
        <canvas ref={canvasRef} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerLeave={onUp}
          className={cn("w-full touch-none rounded-lg", mode ? "cursor-crosshair" : "cursor-move")} style={{ height: 340 }} />
      </div>
      <div className="mt-1 flex items-center justify-between text-[11px] text-ink-faint">
        <span>{mode ? `${mode === "initialpose" ? "2D Pose" : "Nav Goal"}: 클릭+드래그로 위치·방향 지정` : "드래그=이동 · 휠=확대 · 🟢로봇 🔵footprint 🔴scan"}</span>
        {msg && <span className="text-ink-soft">{msg}</span>}
      </div>
    </Shell>
  );
}

// ── 카메라 위젯 (이미지 토픽 → MJPEG 뷰) ──
export function CameraWidget({ panel, onChange, onRemove, canRemove }: {
  panel: Panel; onChange: (p: Partial<Panel>) => void; onRemove: () => void; canRemove: boolean;
}) {
  const [topics, setTopics] = useState<{ topic: string; type: string; compressed: boolean }[]>([]);
  const [available, setAvailable] = useState(true);
  const [err, setErr] = useState(false);
  const topic = panel.camTopic || "";

  const load = () => api.cameraTopics().then((r) => { setTopics(r.topics); setAvailable(r.available); }).catch(() => {});
  useEffect(() => { load(); }, []);

  return (
    <Shell title="카메라" onRemove={onRemove} canRemove={canRemove}
      head={
        <select value={topic} onChange={(e) => { setErr(false); onChange({ camTopic: e.target.value }); }}
          className="rounded-lg border border-surface-line bg-surface px-2 py-1 text-xs max-w-[220px]">
          <option value="">이미지 토픽…</option>
          {topics.map((t) => <option key={t.topic} value={t.topic}>{t.topic}{t.compressed ? " (압축)" : ""}</option>)}
        </select>
      }>
      {!available ? (
        <div className="py-8 text-center text-sm text-warn">서버에 cv2/cv_bridge 없음 — 카메라 변환 불가</div>
      ) : !topic ? (
        <div className="py-8 text-center text-sm text-ink-faint">
          이미지 토픽을 선택하세요{topics.length === 0 ? " (발행 중인 이미지 토픽 없음)" : ""}
        </div>
      ) : err ? (
        <div className="py-8 text-center text-sm text-danger">스트림 오류 — 토픽/발행 상태 확인</div>
      ) : (
        // MJPEG 스트림: key 로 토픽 변경 시 재연결, 언마운트 시 연결 종료
        // eslint-disable-next-line @next/next/no-img-element
        <img key={topic} src={cameraStreamUrl(topic)} alt={topic} onError={() => setErr(true)}
          className="w-full rounded-lg bg-ink/5" />
      )}
    </Shell>
  );
}

// ── Recorder 위젯 (백엔드 풀레이트 녹화 → Wide CSV) ──
export function RecorderWidget({ topics, onRemove, canRemove }: {
  panel: Panel; topics: Topic[]; onRemove: () => void; canRemove: boolean;
}) {
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  const [recDiag, setRecDiag] = useState(true);
  const [recSystem, setRecSystem] = useState(false);
  const [name, setName] = useState("");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<{ rows: number; elapsed: number } | null>(null);
  const [recordings, setRecordings] = useState<{ file: string; rows: number | null }[]>([]);
  const [last, setLast] = useState<{ file?: string; rows?: number; columns?: number } | null>(null);

  const loadRecordings = () => api.recordings().then(setRecordings).catch(() => {});
  useEffect(() => { loadRecordings(); }, []);
  useEffect(() => {
    if (!activeId) return;
    const id = setInterval(async () => {
      const a = await api.recActive().catch(() => []);
      const s = a.find((x) => x.id === activeId);
      if (s) setStatus({ rows: s.rows, elapsed: s.elapsed_s });
    }, 1000);
    return () => clearInterval(id);
  }, [activeId]);

  const start = async () => {
    const tList = topics.filter((t) => sel.has(t.topic)).map((t) => ({ topic: t.topic, msgType: t.types[0] }));
    if (tList.length === 0 && !recDiag && !recSystem) return;
    const r = await api.recStart({ name, topics: tList, diagnostics: recDiag, system: recSystem }).catch(() => null);
    if (r) { setActiveId(r.id); setLast(null); setStatus({ rows: 0, elapsed: 0 }); }
  };
  const stop = async () => {
    if (!activeId) return;
    const r = await api.recStop(activeId).catch(() => null);
    setActiveId(null); setStatus(null);
    if (r?.file) setLast(r);
    loadRecordings();
  };
  const toggle = (t: string) => { const n = new Set(sel); n.has(t) ? n.delete(t) : n.add(t); setSel(n); };
  const filtered = topics.filter((t) => t.topic.toLowerCase().includes(q.toLowerCase()));

  return (
    <Shell title="Recorder" onRemove={onRemove} canRemove={canRemove}>
      {activeId ? (
        <div className="space-y-3">
          <div className="flex items-center gap-2 rounded-xl bg-danger/5 px-3 py-2">
            <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-danger" />
            <span className="text-sm font-semibold text-danger">녹화 중</span>
            <span className="ml-auto font-mono text-xs text-ink-soft">{status?.rows ?? 0}행 · {Math.round(status?.elapsed ?? 0)}s</span>
          </div>
          <button onClick={stop} className="w-full rounded-xl bg-danger px-3 py-2 text-sm font-semibold text-white active:scale-[.98]">■ 정지 & CSV 저장</button>
        </div>
      ) : (
        <div className="space-y-2">
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="녹화 이름 (선택)"
            className="w-full rounded-lg border border-surface-line px-2 py-1 text-sm" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`토픽 검색 (선택 ${sel.size})`}
            className="w-full rounded-lg border border-surface-line px-2 py-1 text-xs" />
          <div className="max-h-32 overflow-auto rounded-lg border border-surface-line divide-y divide-surface-line">
            {filtered.map((t) => (
              <label key={t.topic} className="flex items-center gap-2 px-2 py-1 text-xs">
                <input type="checkbox" checked={sel.has(t.topic)} onChange={() => toggle(t.topic)} />
                <span className="truncate">{t.topic}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-4 text-xs">
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={recDiag} onChange={(e) => setRecDiag(e.target.checked)} /> diagnostics</label>
            <label className="flex items-center gap-1.5"><input type="checkbox" checked={recSystem} onChange={(e) => setRecSystem(e.target.checked)} /> 시스템</label>
          </div>
          <button onClick={start} className="w-full rounded-xl bg-brand-500 px-3 py-2 text-sm font-semibold text-white active:scale-[.98]">● 녹화 시작</button>
        </div>
      )}

      {last?.file && (
        <div className="mt-3 rounded-lg bg-ok/5 px-3 py-2 text-xs">
          저장됨: {last.rows}행 · {last.columns}열 — <a className="font-medium text-brand-700 underline" href={recordingDownloadUrl(last.file)}>다운로드</a>
        </div>
      )}

      <div className="mt-3 text-[11px] font-medium text-ink-faint">저장된 녹화</div>
      <div className="max-h-28 space-y-1 overflow-auto">
        {recordings.length === 0 && <div className="text-xs text-ink-faint">없음</div>}
        {recordings.map((r) => (
          <div key={r.file} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate" title={r.file}>{r.file}</span>
            {r.rows != null && <span className="shrink-0 text-ink-faint">{r.rows}행</span>}
            <a className="shrink-0 text-brand-700 underline" href={recordingDownloadUrl(r.file)}>CSV</a>
          </div>
        ))}
      </div>
    </Shell>
  );
}

// 게임패드 시각화 (joystick_controller 참고) — standard mapping 버튼 이름
const GP_BTN = ["A", "B", "X", "Y", "LB", "RB", "LT", "RT", "Sel", "Start", "LS", "RS", "↑", "↓", "←", "→", "Home"];
function StickView({ x, y, label }: { x: number; y: number; label: string }) {
  return (
    <div className="relative h-20 w-20 rounded-full border border-surface-line bg-surface">
      <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-surface-line" />
      <div className="absolute top-1/2 left-0 h-px w-full -translate-y-1/2 bg-surface-line" />
      <div className="absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-brand-500"
        style={{ left: `${((x + 1) / 2) * 100}%`, top: `${((y + 1) / 2) * 100}%` }} />
      <span className="absolute -bottom-4 left-1/2 -translate-x-1/2 whitespace-nowrap text-[9px] text-ink-faint">{label}</span>
    </div>
  );
}

function KbKey({ on, label, sub, cls }: { on: boolean; label: string; sub: string; cls?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center rounded-lg border py-2",
      on ? "border-brand-500 bg-brand-500 text-white" : "border-surface-line bg-surface text-ink-soft", cls)}>
      <span className="text-sm font-bold">{label}</span>
      <span className="text-[9px] opacity-80">{sub}</span>
    </div>
  );
}

// ── 텔레옵 위젯 (전방향 XY 패드 + 회전 슬라이더, 데드맨) ──
export function TeleopWidget({ panel, onChange, onRemove, canRemove }: {
  panel: Panel; onChange: (p: Partial<Panel>) => void; onRemove: () => void; canRemove: boolean;
}) {
  const topic = panel.cmdTopic || "/swerve_controller/cmd_vel";
  const [maxLin, setMaxLin] = useState(0.4);   // m/s
  const [maxYaw, setMaxYaw] = useState(0.8);   // rad/s
  const [knob, setKnob] = useState({ x: 0, y: 0 });  // 화면좌표 정규화 (-1..1), x=우+, y=하+
  const [rot, setRot] = useState(0);                 // -1(좌)..1(우)
  const [padActive, setPadActive] = useState(false);
  const [rotActive, setRotActive] = useState(false);
  const [pub, setPub] = useState({ x: 0, y: 0, z: 0 });
  const [src, setSrc] = useState<"pad" | "gamepad" | "keyboard">("pad");
  const [gp, setGp] = useState<{ id: string; deadman: boolean; axes: number[]; buttons: { p: boolean; v: number }[] } | null>(null);
  const [keys, setKeys] = useState<Set<string>>(new Set());   // 눌린 키(i/j/k/l/shift) 시각화
  const keysRef = useRef<Set<string>>(new Set());
  const [kbFocused, setKbFocused] = useState(false);
  const kbFocusedRef = useRef(false);
  const padRef = useRef<HTMLDivElement>(null);
  const valsRef = useRef({ x: 0, y: 0, z: 0 });

  // REP-103: x 전진, y 좌측+, z CCW+. 패드 위(-y)=전진, 좌(-x)=+y. 슬라이더 좌(-)= 좌회전(+z).
  const fwd = -knob.y, left = -knob.x;
  useEffect(() => {
    valsRef.current = { x: fwd * maxLin, y: left * maxLin, z: -rot * maxYaw };
  }, [fwd, left, rot, maxLin, maxYaw]);

  const send = (x: number, y: number, z: number) => {
    setPub({ x, y, z });
    api.publish(topic, "geometry_msgs/msg/Twist", { linear: { x, y, z: 0 }, angular: { x: 0, y: 0, z } }).catch(() => {});
  };

  const active = (src === "pad") && (padActive || rotActive);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => { const v = valsRef.current; send(v.x, v.y, v.z); }, 66);  // ~15Hz
    return () => { clearInterval(id); send(0, 0, 0); };  // 떼면 즉시 정지
    // eslint-disable-next-line
  }, [active]);

  // 게임패드 소스: W3C Gamepad API. 매핑은 로봇 teleop 의미 따름.
  // 데드맨 = LT(buttons[6]) 누르는 동안만. 좌스틱=평행이동, 우스틱X=회전.
  useEffect(() => {
    if (src !== "gamepad") return;
    const prev = { dead: false };
    const dz = (v: number) => (Math.abs(v) < 0.05 ? 0 : v);
    const id = setInterval(() => {
      const pads = (navigator.getGamepads?.() ?? []) as (Gamepad | null)[];
      const g = pads.find((p) => p) || null;
      if (!g) { setGp(null); if (prev.dead) { send(0, 0, 0); prev.dead = false; } return; }
      const lt = g.buttons[6]?.value ?? 0;          // 왼쪽 트리거 = 데드맨
      const deadman = lt > 0.05;
      const holo = g.buttons[5]?.pressed ?? false;  // RB = 횡이동(y) 활성 모디파이어
      setGp({ id: g.id, deadman, axes: Array.from(g.axes), buttons: g.buttons.map((b) => ({ p: b.pressed, v: b.value })) });
      if (deadman) {
        const x = -dz(g.axes[1] ?? 0) * maxLin;     // 좌스틱 위=전진(+x)
        const y = holo ? -dz(g.axes[0] ?? 0) * maxLin : 0;  // RB 누를 때만 좌스틱 좌=+y
        const z = -dz(g.axes[2] ?? 0) * maxYaw;     // 우스틱 우=시계(-z)
        send(x, y, z); prev.dead = true;
      } else if (prev.dead) { send(0, 0, 0); prev.dead = false; }
    }, 66);
    return () => { clearInterval(id); send(0, 0, 0); };
    // eslint-disable-next-line
  }, [src, maxLin, maxYaw]);

  // 키보드 소스: i/k=전후, Shift 없으면 j/l=회전, Shift면 j/l=횡이동. 포커스 시에만.
  useEffect(() => {
    if (src !== "keyboard") return;
    const prev = { moving: false };
    const id = setInterval(() => {
      const k = keysRef.current;
      const shift = k.has("shift");
      let x = 0, y = 0, z = 0;
      if (!k.has("k")) {   // k = 정지(0). 누르면 전부 0
        if (k.has("i")) x += maxLin;
        if (k.has(",")) x -= maxLin;
        if (shift) { if (k.has("j")) y += maxLin; if (k.has("l")) y -= maxLin; }
        else { if (k.has("j")) z += maxYaw; if (k.has("l")) z -= maxYaw; }
      }
      const moving = x !== 0 || y !== 0 || z !== 0;
      if (kbFocusedRef.current && moving) { send(x, y, z); prev.moving = true; }
      else if (prev.moving) { send(0, 0, 0); prev.moving = false; }
    }, 66);
    return () => { clearInterval(id); send(0, 0, 0); };
    // eslint-disable-next-line
  }, [src, maxLin, maxYaw]);

  const CODE: Record<string, string> = { KeyI: "i", KeyJ: "j", KeyK: "k", KeyL: "l", Comma: ",", ShiftLeft: "shift", ShiftRight: "shift" };
  const onKbDown = (e: React.KeyboardEvent) => {
    const m = CODE[e.code]; if (!m) return; e.preventDefault();
    keysRef.current.add(m); setKeys(new Set(keysRef.current));
  };
  const onKbUp = (e: React.KeyboardEvent) => {
    const m = CODE[e.code]; if (!m) return;
    keysRef.current.delete(m); setKeys(new Set(keysRef.current));
  };
  const kbBlur = () => { keysRef.current.clear(); setKeys(new Set()); kbFocusedRef.current = false; setKbFocused(false); };

  const padMove = (e: React.PointerEvent) => {
    const r = padRef.current!.getBoundingClientRect();
    let dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
    let dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
    const m = Math.hypot(dx, dy); if (m > 1) { dx /= m; dy /= m; }
    setKnob({ x: dx, y: dy });
  };

  return (
    <Shell title="텔레옵" onRemove={onRemove} canRemove={canRemove}
      head={
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg bg-surface-muted p-0.5 text-xs">
            {(["pad", "gamepad", "keyboard"] as const).map((s) => (
              <button key={s} onClick={() => setSrc(s)}
                className={cn("rounded-md px-2 py-0.5", src === s ? "bg-surface text-ink shadow-card" : "text-ink-faint")}>
                {s === "pad" ? "화면패드" : s === "gamepad" ? "게임패드" : "키패드"}
              </button>
            ))}
          </div>
          <span className="font-mono text-[11px] text-ink-faint">x{pub.x.toFixed(2)} y{pub.y.toFixed(2)} z{pub.z.toFixed(2)}</span>
        </div>
      }>
      <div className="flex flex-col items-center gap-3">
        {/* 게임패드 상태 */}
        {src === "gamepad" && (
          <div className="w-full rounded-xl border border-surface-line bg-surface-muted p-3 text-sm">
            {gp ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="truncate text-xs text-ink-soft">🎮 {gp.id.slice(0, 30)}</span>
                  <span className={cn("rounded-md px-2 py-0.5 text-xs font-bold", gp.deadman ? "bg-ok text-white" : "bg-surface-line text-ink-faint")}>
                    {gp.deadman ? "주행 中 (LT)" : "LT 떼짐"}
                  </span>
                </div>
                {/* 스틱 시각화 */}
                <div className="mt-3 flex justify-around pb-4">
                  <StickView x={gp.axes[0] ?? 0} y={gp.axes[1] ?? 0} label="좌(이동)" />
                  <StickView x={gp.axes[2] ?? 0} y={gp.axes[3] ?? 0} label="우(회전)" />
                </div>
                {/* 버튼 상태 */}
                <div className="flex flex-wrap gap-1">
                  {gp.buttons.map((b, i) => (
                    <span key={i} className={cn("rounded px-1.5 py-0.5 text-[10px] font-medium",
                      b.p ? (i === 6 ? "bg-ok text-white" : "bg-brand-500 text-white") : "bg-surface text-ink-faint")}>
                      {GP_BTN[i] ?? i}{(i === 6 || i === 7) && b.v > 0.02 ? `·${b.v.toFixed(1)}` : ""}
                    </span>
                  ))}
                </div>
                <div className="mt-2 font-mono text-xs text-ink-soft">x{pub.x.toFixed(2)} y{pub.y.toFixed(2)} z{pub.z.toFixed(2)}</div>
                <div className="text-[11px] text-ink-faint">LT 누른 채: 좌스틱 전후 + 우스틱 회전 · <b className={cn(gp.buttons[5]?.p && "text-brand-600")}>RB 추가로 누르면 횡이동(y)</b></div>
              </>
            ) : (
              <div className="py-3 text-center text-xs text-ink-faint">게임패드 미감지 — 패드 연결 후 아무 버튼이나 누르세요</div>
            )}
          </div>
        )}

        {/* 키보드 소스 */}
        {src === "keyboard" && (
          <div tabIndex={0} onKeyDown={onKbDown} onKeyUp={onKbUp}
            onFocus={() => { kbFocusedRef.current = true; setKbFocused(true); }} onBlur={kbBlur}
            className={cn("w-full rounded-xl border p-3 outline-none", kbFocused ? "border-brand-500 bg-surface" : "border-surface-line bg-surface-muted")}>
            <div className="mb-2 text-center text-xs font-medium">
              {kbFocused ? <span className="text-ok">키 입력 활성 (포커스 유지)</span> : <span className="text-ink-faint">여기를 클릭해 키 입력 활성화</span>}
            </div>
            <div className="mx-auto flex w-72 items-center gap-3">
              <KbKey on={keys.has("shift")} label="Shift" sub="횡이동(y)" cls="w-20 shrink-0" />
              <div className="grid flex-1 grid-cols-3 gap-1.5">
                <span /><KbKey on={keys.has("i")} label="I" sub="전진" /><span />
                <KbKey on={keys.has("j")} label="J" sub={keys.has("shift") ? "횡 ←" : "좌회전"} />
                <KbKey on={keys.has("k")} label="K" sub="정지" />
                <KbKey on={keys.has("l")} label="L" sub={keys.has("shift") ? "횡 →" : "우회전"} />
                <span /><KbKey on={keys.has(",")} label="," sub="후진" /><span />
              </div>
            </div>
            <div className="mt-2 text-center font-mono text-xs text-ink-soft">x{pub.x.toFixed(2)} y{pub.y.toFixed(2)} z{pub.z.toFixed(2)}</div>
          </div>
        )}

        {/* XY 평행이동 패드 (화면패드 소스) */}
        {src === "pad" && <>
        <div
          ref={padRef}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); setPadActive(true); padMove(e); }}
          onPointerMove={(e) => { if (padActive) padMove(e); }}
          onPointerUp={() => { setPadActive(false); setKnob({ x: 0, y: 0 }); }}
          onPointerCancel={() => { setPadActive(false); setKnob({ x: 0, y: 0 }); }}
          className="relative h-44 w-44 touch-none select-none rounded-full border border-surface-line bg-surface-muted"
        >
          <div className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-surface-line" />
          <div className="absolute top-1/2 left-0 w-full h-px -translate-y-1/2 bg-surface-line" />
          <span className="absolute left-1/2 top-1 -translate-x-1/2 text-[10px] text-ink-faint">전진</span>
          <span className="absolute left-1/2 bottom-1 -translate-x-1/2 text-[10px] text-ink-faint">후진</span>
          <span className="absolute top-1/2 left-1 -translate-y-1/2 text-[10px] text-ink-faint">좌</span>
          <span className="absolute top-1/2 right-1 -translate-y-1/2 text-[10px] text-ink-faint">우</span>
          <div
            className={cn("absolute h-10 w-10 rounded-full shadow-card -translate-x-1/2 -translate-y-1/2 transition-colors",
              padActive ? "bg-brand-500" : "bg-brand-100")}
            style={{ left: `${50 + knob.x * 42}%`, top: `${50 + knob.y * 42}%` }}
          />
        </div>

        {/* 회전 슬라이더 (스프링 복귀) */}
        <div className="w-full px-2">
          <div className="mb-1 flex justify-between text-[10px] text-ink-faint"><span>↺ 좌회전</span><span>회전(z)</span><span>우회전 ↻</span></div>
          <input type="range" min={-1} max={1} step={0.02} value={rot}
            onPointerDown={() => setRotActive(true)}
            onChange={(e) => setRot(Number(e.target.value))}
            onPointerUp={() => { setRotActive(false); setRot(0); }}
            onPointerCancel={() => { setRotActive(false); setRot(0); }}
            className="w-full" />
        </div>
        </>}

        {/* 속도 한계 + 대상 토픽 (공통) */}
        <div className="grid w-full grid-cols-2 gap-2 text-xs">
          <label className="flex items-center gap-1">최대 직진 <input type="number" step="0.1" value={maxLin} onChange={(e) => setMaxLin(Number(e.target.value))} className="w-16 rounded border border-surface-line px-1 py-0.5" /> m/s</label>
          <label className="flex items-center gap-1">최대 회전 <input type="number" step="0.1" value={maxYaw} onChange={(e) => setMaxYaw(Number(e.target.value))} className="w-16 rounded border border-surface-line px-1 py-0.5" /> rad/s</label>
        </div>
        <input value={topic} onChange={(e) => onChange({ cmdTopic: e.target.value })}
          className="w-full rounded-lg border border-surface-line px-2 py-1 text-xs" placeholder="/swerve_controller/cmd_vel" />
        <div className="text-[11px] text-warn">⚠ {src === "gamepad" ? "LT" : "누르고 있는 동안"}만 전송(데드맨). 떼면 즉시 정지. 컨트롤러 active 필요.</div>
      </div>
    </Shell>
  );
}

// ── 명령 위젯 (publish / service) ──
const isBool = (b: string) => b === "boolean" || b === "bool";
const isNum = (b: string) => NUMERIC.has(b) && !isBool(b);

function FieldForm({ fields, vals, setVals }: {
  fields: Field[]; vals: Record<string, any>; setVals: (f: (v: any) => any) => void;
}) {
  return (
    <div className="space-y-1.5">
      {fields.map((f) => (
        <div key={f.path} className="flex items-center gap-2">
          <label className="w-36 shrink-0 truncate text-xs text-ink-soft" title={f.path}>
            {f.path}<span className="text-ink-faint"> {f.base_type}</span>
          </label>
          {isBool(f.base_type) ? (
            <input type="checkbox" checked={!!vals[f.path]} onChange={(e) => setVals((v) => ({ ...v, [f.path]: e.target.checked }))} />
          ) : (
            <input type={isNum(f.base_type) ? "number" : "text"} step="any" value={vals[f.path] ?? ""}
              onChange={(e) => setVals((v) => ({ ...v, [f.path]: e.target.value }))}
              className="flex-1 rounded-lg border border-surface-line px-2 py-1 text-sm" placeholder={f.base_type} />
          )}
        </div>
      ))}
    </div>
  );
}
function buildPayload(fields: Field[], vals: Record<string, any>) {
  const data: any = {};
  fields.forEach((f) => {
    const raw = vals[f.path];
    const val = isBool(f.base_type) ? !!raw : isNum(f.base_type) ? Number(raw ?? 0) : (raw ?? "");
    setPath(data, f.path, val);
  });
  return data;
}

type CmdMode = "publish" | "service" | "action";
export function CommandWidget({ panel, topics, typeOf, onChange, onRemove, canRemove }: {
  panel: Panel; topics: Topic[]; typeOf: (t: string) => string | undefined;
  onChange: (p: Partial<Panel>) => void; onRemove: () => void; canRemove: boolean;
}) {
  const [mode, setMode] = useState<CmdMode>("publish");
  const [fields, setFields] = useState<Field[]>([]);
  const [vals, setVals] = useState<Record<string, any>>({});
  const [msg, setMsg] = useState("");
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonText, setJsonText] = useState("{}");
  // service
  const [services, setServices] = useState<{ service: string; types: string[] }[]>([]);
  const [svc, setSvc] = useState(""); const [svcType, setSvcType] = useState("");
  // action
  const [acts, setActs] = useState<{ action: string; types: string[] }[]>([]);
  const [act, setAct] = useState(""); const [actType, setActType] = useState(""); const [gid, setGid] = useState<string | null>(null);
  const actionEvents = useTb((s) => s.actions);

  const topic = panel.cmdTopic ?? "";
  const hasArray = fields.some((f) => f.array);
  const scalarFields = fields.filter((f) => !f.array);

  useEffect(() => { // publish 필드
    if (mode !== "publish") return;
    let alive = true; setVals({}); setMsg("");
    if (!topic) { setFields([]); return; }
    api.topicFields(topic, typeOf(topic)).then((r) => alive && setFields(r.fields)).catch(() => alive && setFields([]));
    return () => { alive = false; };
  }, [topic, mode]); // eslint-disable-line
  useEffect(() => { if (mode === "service") api.services().then(setServices).catch(() => {}); }, [mode]);
  useEffect(() => { if (mode === "action") api.actions().then(setActs).catch(() => {}); }, [mode]);
  useEffect(() => { // service 요청 필드
    if (mode !== "service") return;
    let alive = true; setVals({}); setMsg("");
    if (!svc) { setFields([]); setSvcType(""); return; }
    api.serviceFields(svc).then((r) => { if (!alive) return; setFields(r.fields); setSvcType(r.type); setJsonText("{}"); }).catch(() => alive && setFields([]));
    return () => { alive = false; };
  }, [svc, mode]); // eslint-disable-line
  useEffect(() => { // action goal 필드
    if (mode !== "action") return;
    let alive = true; setVals({}); setMsg(""); setGid(null);
    if (!act) { setFields([]); setActType(""); return; }
    api.actionFields(act).then((r) => { if (!alive) return; setFields(r.fields); setActType(r.type); setJsonText("{}"); }).catch(() => alive && setFields([]));
    return () => { alive = false; };
  }, [act, mode]); // eslint-disable-line

  const buildReq = () => (jsonMode ? JSON.parse(jsonText) : buildPayload(scalarFields, vals));
  const sendPublish = async () => {
    const type = typeOf(topic); if (!type) return;
    try { await api.publish(topic, type, buildPayload(scalarFields, vals)); setMsg("publish ✓ " + new Date().toLocaleTimeString()); } catch (e) { setMsg(String(e)); }
  };
  const callSvc = async () => {
    if (!svc || !svcType) return; let b: any;
    try { b = buildReq(); } catch { setMsg("JSON 파싱 오류"); return; }
    try { const r = await api.callService(svcType, svc, b); setMsg("응답: " + JSON.stringify(r.response ?? r)); } catch (e) { setMsg(String(e)); }
  };
  const sendAction = async () => {
    if (!act || !actType) return; let g: any;
    try { g = buildReq(); } catch { setMsg("JSON 파싱 오류"); return; }
    try { const r = await api.sendAction(actType, act, g); setGid(r.goal_id); setMsg(r.accepted ? `goal 수락 (${r.goal_id})` : "goal 거부됨"); } catch (e) { setMsg(String(e)); }
  };
  const cancel = async () => { if (gid) { try { await api.cancelAction(gid); setMsg("취소 요청 전송"); } catch (e) { setMsg(String(e)); } } };

  // 주의: 컴포넌트(<SendForm/>)로 두면 매 렌더 리마운트→입력 포커스 손실. 함수 호출로 인라인 렌더.
  const renderSend = (onSend: () => void, label: string) => (
    <div className="space-y-2">
      {(hasArray || fields.length === 0) && (
        <label className="flex items-center gap-1.5 text-xs text-ink-soft">
          <input type="checkbox" checked={jsonMode} onChange={(e) => setJsonMode(e.target.checked)} /> JSON 직접 입력 (배열/복합/타입 미상)
        </label>
      )}
      {jsonMode ? (
        <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} rows={5}
          className="w-full rounded-lg border border-surface-line px-2 py-1 font-mono text-xs" placeholder='{"order": 5}' />
      ) : scalarFields.length > 0 ? <FieldForm fields={scalarFields} vals={vals} setVals={setVals} />
        : <div className="text-xs text-ink-faint">필드 없음/미상 — 필요 시 JSON 직접 입력</div>}
      <button onClick={onSend} className="mt-1 w-full rounded-lg bg-brand-500 px-3 py-2 text-sm font-semibold text-white active:scale-[.98]">{label}</button>
      {msg && <div className="break-all text-xs text-ink-faint">{msg}</div>}
    </div>
  );

  const ev = gid ? actionEvents[gid] : undefined;

  return (
    <Shell title="명령" onRemove={onRemove} canRemove={canRemove}
      head={
        <div className="flex items-center gap-1.5">
          <div className="flex rounded-lg bg-surface-muted p-0.5 text-xs">
            {(["publish", "service", "action"] as CmdMode[]).map((m) => (
              <button key={m} onClick={() => { setMode(m); setFields([]); setMsg(""); setJsonMode(false); }}
                className={cn("rounded-md px-2 py-0.5", mode === m ? "bg-surface text-ink shadow-card" : "text-ink-faint")}>
                {m === "publish" ? "토픽" : m === "service" ? "서비스" : "액션"}
              </button>
            ))}
          </div>
          {mode === "publish" && (
            <select value={topic} onChange={(e) => onChange({ cmdTopic: e.target.value })} className="rounded-lg border border-surface-line bg-surface px-2 py-1 text-xs max-w-[180px]">
              <option value="">토픽…</option>{topics.map((t) => <option key={t.topic} value={t.topic}>{t.topic}</option>)}
            </select>
          )}
          {mode === "service" && (
            <select value={svc} onChange={(e) => setSvc(e.target.value)} className="rounded-lg border border-surface-line bg-surface px-2 py-1 text-xs max-w-[180px]">
              <option value="">서비스…</option>{services.map((s) => <option key={s.service} value={s.service}>{s.service}</option>)}
            </select>
          )}
          {mode === "action" && (
            <select value={act} onChange={(e) => setAct(e.target.value)} className="rounded-lg border border-surface-line bg-surface px-2 py-1 text-xs max-w-[180px]">
              <option value="">액션…</option>{acts.map((a) => <option key={a.action} value={a.action}>{a.action}</option>)}
            </select>
          )}
        </div>
      }>
      {mode === "publish" && (topic
        ? renderSend(sendPublish, "보내기 (publish)")
        : <div className="py-4 text-sm text-ink-faint">토픽을 선택하세요 (예: /swerve_controller/cmd_vel)</div>)}
      {mode === "service" && (svc
        ? <><div className="mb-1 text-[11px] text-ink-faint">{svcType}</div>{renderSend(callSvc, "호출 (call)")}</>
        : <div className="py-4 text-sm text-ink-faint">서비스를 선택하세요</div>)}
      {mode === "action" && (act
        ? <>
            <div className="mb-1 text-[11px] text-ink-faint">{actType}</div>
            {renderSend(sendAction, "goal 전송")}
            {gid && (
              <div className="mt-2 rounded-lg bg-surface-muted p-2 text-xs">
                <div className="flex items-center justify-between">
                  <span className="font-medium">goal {gid}</span>
                  {!ev?.result && <button onClick={cancel} className="rounded bg-danger/10 px-2 py-0.5 text-danger">취소</button>}
                </div>
                {ev?.feedback && <div className="mt-1 break-all text-ink-soft">feedback: {JSON.stringify(ev.feedback)}</div>}
                {ev?.result && <div className="mt-1 break-all text-ok">result(status {ev.result.status}): {JSON.stringify(ev.result.result)}</div>}
              </div>
            )}
          </>
        : <div className="py-4 text-sm text-ink-faint">액션을 선택하세요 (예: /navigate_to_pose)</div>)}
    </Shell>
  );
}
