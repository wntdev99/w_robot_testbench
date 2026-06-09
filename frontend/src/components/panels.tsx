"use client";
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { Card } from "@/components/Card";
import { PlotPanel, PlotSample } from "@/components/PlotPanel";
import { cn } from "@/lib/cn";

export type PanelType = "plot" | "controllers" | "motors" | "command";
export type PlotSource = "topic" | "system";
export type Panel = {
  id: string;
  type: PanelType;
  title?: string;
  // plot
  source?: PlotSource;   // 기본 "topic"
  topic?: string;
  msgType?: string;
  chosen?: string[];
  sysCat?: string;       // 시스템 소스 선택 카테고리(cpu/mem/temp/net/conn)
  // command
  cmdTopic?: string;
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

function Shell({ title, onRemove, canRemove, head, children }: {
  title: string; onRemove: () => void; canRemove: boolean; head?: React.ReactNode; children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0">
      <div className="flex items-center gap-2 mb-3">
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
    for (const f of fields) {
      if (!chosen.has(f.path)) continue;
      const v = sample ? getPath(sample.values, f.path) : undefined;
      if (f.array) (Array.isArray(v) ? v : []).forEach((x, i) => { lbls.push(`${f.path}[${i}]`); vals.push(num(x)); });
      else { lbls.push(f.path); vals.push(num(v)); }
    }
    return { labels: lbls, latest: sample && lbls.length ? ({ t: sample.ts, vals } as PlotSample) : null };
  }, [fields, chosen, sample]);

  const setSource = (s: PlotSource) => onChange({ source: s, topic: "", chosen: [], msgType: undefined, sysCat: undefined });

  return (
    <Shell title="플롯" onRemove={onRemove} canRemove={canRemove}
      head={
        <div className="flex items-center gap-1.5">
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
      {fields.length > 0 && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {fields.map((f) => (
            <button key={f.path} onClick={() => toggle(f.path)}
              className={cn("rounded-md border px-2 py-0.5 text-xs", chosen.has(f.path) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-surface-line text-ink-soft")}>
              {f.path}{f.array ? "[]" : ""}
            </button>
          ))}
        </div>
      )}
      {source === "system" ? (
        labels.length > 0 ? <PlotPanel title="" seriesLabels={labels} latest={latest} windowSec={120} height={200} />
          : <div className="py-6 text-center text-sm text-ink-faint">{system ? "필드를 선택하세요" : "시스템 데이터 대기…"}</div>
      ) : panel.topic ? (
        labels.length > 0 ? <PlotPanel title="" seriesLabels={labels} latest={latest} windowSec={30} height={200} />
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

// ── 모터 진단 위젯 ──
const MOTORS = [
  { id: "can2:11", label: "조향 FL" }, { id: "can2:12", label: "조향 FR" },
  { id: "can2:13", label: "조향 RL" }, { id: "can2:14", label: "조향 RR" },
];
export function MotorsWidget({ onRemove, canRemove }: { panel: Panel; onRemove: () => void; canRemove: boolean }) {
  const diag = useTb((s) => s.diagnostics);
  return (
    <Shell title="모터 진단" onRemove={onRemove} canRemove={canRemove}>
      <table className="w-full text-sm">
        <thead><tr className="text-left text-xs text-ink-faint border-b border-surface-line">
          <th className="py-1">모터</th><th>온도℃</th><th>전류A</th><th>토크Nm</th><th>fault</th></tr></thead>
        <tbody>
          {MOTORS.map((m) => {
            const d = diag[m.id]; const t = d ? Number(d.temperature_C) : null;
            return (
              <tr key={m.id} className="border-b border-surface-line">
                <td className="py-1 font-medium">{m.label}</td>
                <td className={cn("tabular-nums", t != null && t >= 60 ? "text-danger" : "")}>{d?.temperature_C ?? "—"}</td>
                <td className="tabular-nums">{d ? Number(d.current_A).toFixed(3) : "—"}</td>
                <td className="tabular-nums">{d ? Number(d.effort_Nm).toFixed(3) : "—"}</td>
                <td className="tabular-nums">{d?.fault_code ?? "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
