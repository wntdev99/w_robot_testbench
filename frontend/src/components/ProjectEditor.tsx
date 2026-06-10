"use client";

import { useEffect, useState } from "react";
import { api, type Project, type Widget } from "@/lib/api";
import { WidgetGrid, type Pos } from "@/components/WidgetGrid";

const WIDGET_KINDS = [
  { kind: "plot.topic", label: "토픽 플롯" },
  { kind: "diagnostics", label: "Diagnostics" },
  { kind: "state", label: "상태 표시" },
  { kind: "image", label: "카메라(MJPEG)" },
  { kind: "control.topic_pub", label: "토픽 발행(제어)" },
  { kind: "control.service", label: "서비스 호출" },
  { kind: "control.action", label: "액션 요청" },
  { kind: "process", label: "런치/노드 실행" },
];

type Topic = { name: string; types: string[] };

// 레이아웃 빌더 — 위젯 팔레트·편집·저장 (P2, 부속 D §2 layout)
export function ProjectEditor({ project, onSaved }: { project: Project; onSaved: (p: Project) => void }) {
  const [name, setName] = useState(project.name);
  const [widgets, setWidgets] = useState<Widget[]>(project.layout?.widgets ?? []);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [services, setServices] = useState<Topic[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.topics().then((r) => setTopics(r.topics)).catch(() => {});
    api.services().then((r) => setServices(r.services)).catch(() => {});
  }, []);

  const addWidget = (kind: string) => {
    const id = `w_${Date.now().toString(36)}`;
    setWidgets([...widgets, { id, kind, title: WIDGET_KINDS.find((k) => k.kind === kind)?.label ?? kind,
      pos: { x: 0, y: widgets.length * 4, w: 6, h: 4 } }]);
  };
  const patch = (id: string, p: Partial<Widget>) =>
    setWidgets(widgets.map((w) => (w.id === id ? { ...w, ...p } : w)));
  const remove = (id: string) => setWidgets(widgets.filter((w) => w.id !== id));
  const applyLayout = (byId: Record<string, Pos>) =>
    setWidgets((ws) => ws.map((w) => (byId[w.id] ? { ...w, pos: { ...w.pos, ...byId[w.id] } } : w)));

  const save = async () => {
    setBusy(true);
    try {
      const body = { ...project, name, layout: { grid: project.layout?.grid ?? { cols: 12, row_h: 40 }, widgets } };
      const saved = project.origin === "user"
        ? await api.updateProject(project.id, body as Project)
        : await api.createProject(body);
      onSaved(saved);
    } finally { setBusy(false); }
  };

  return (
    <div className="space-y-4">
      <input value={name} onChange={(e) => setName(e.target.value)}
        className="border border-border rounded-card px-3 py-2 text-lg font-semibold w-full" placeholder="프로젝트 이름" />
      <div className="flex gap-2 flex-wrap items-center">
        {WIDGET_KINDS.map((k) => (
          <button key={k.kind} onClick={() => addWidget(k.kind)}
            className="px-3 py-1.5 rounded-card bg-bg border border-border text-sm">+ {k.label}</button>
        ))}
        <button onClick={save} disabled={busy}
          className="ml-auto px-4 py-1.5 rounded-card bg-primary text-white font-semibold disabled:opacity-50">
          {busy ? "저장 중…" : "저장"}
        </button>
      </div>
      {widgets.length > 0 && (
        <div className="rounded-card border border-border bg-bg/50 p-2">
          <div className="text-xs text-muted mb-1 px-1">배치 — 헤더를 드래그해 이동, 모서리를 끌어 크기 조절</div>
          <WidgetGrid
            widgets={widgets}
            cols={project.layout?.grid?.cols ?? 12}
            rowH={project.layout?.grid?.row_h ?? 40}
            editable
            onLayoutChange={applyLayout}
            renderItem={(w) => (
              <div className="drag-handle cursor-move p-2 text-xs h-full flex flex-col">
                <span className="font-semibold truncate">{w.title || w.kind}</span>
                <span className="text-muted truncate">{w.kind}</span>
              </div>
            )}
          />
        </div>
      )}
      <div className="space-y-3">
        {widgets.map((w) => (
          <WidgetEditRow key={w.id} widget={w} topics={topics} services={services}
            onChange={(p) => patch(w.id, p)} onRemove={() => remove(w.id)} />
        ))}
        {widgets.length === 0 && <div className="text-muted text-sm">위젯을 추가하세요.</div>}
      </div>
    </div>
  );
}

function WidgetEditRow({ widget, topics, services, onChange, onRemove }: {
  widget: Widget; topics: Topic[]; services: Topic[];
  onChange: (p: Partial<Widget>) => void; onRemove: () => void;
}) {
  const isControl = widget.kind === "control.topic_pub";
  const isService = widget.kind === "control.service";
  const isAction = widget.kind === "control.action";
  const isImage = widget.kind === "image";
  const isProcess = widget.kind === "process";
  const selected = widget.name ?? widget.topic ?? "";
  return (
    <div className="rounded-card bg-surface border border-border p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs px-2 py-0.5 rounded bg-bg text-muted">{widget.kind}</span>
        <input value={widget.title} onChange={(e) => onChange({ title: e.target.value })}
          className="border border-border rounded px-2 py-1 text-sm flex-1" placeholder="제목" />
        <label className="text-xs text-muted">폭
          <input type="number" min={2} max={12} value={widget.pos.w}
            onChange={(e) => onChange({ pos: { ...widget.pos, w: +e.target.value } })}
            className="border border-border rounded px-1 py-0.5 w-14 ml-1" />
        </label>
        <button onClick={onRemove} className="text-danger text-sm">삭제</button>
      </div>
      {isProcess ? (
        <div className="space-y-2 text-sm">
          <input value={widget.command ?? ""} onChange={(e) => onChange({ command: e.target.value })}
            placeholder="ros2 launch <pkg> <file>.launch.py 또는 ros2 run ..."
            className="border border-border rounded px-2 py-1 w-full font-mono text-xs" />
          <label className="flex items-center gap-2">머신:
            <select value={widget.machine ?? "server"} onChange={(e) => onChange({ machine: e.target.value })}
              className="border border-border rounded px-2 py-1">
              <option value="server">server (202)</option>
              <option value="controller">controller (201 SSH)</option>
            </select>
          </label>
        </div>
      ) : isService ? (
        <div className="flex items-center gap-2 text-sm">
          서비스:
          <select value={widget.name ?? ""}
            onChange={(e) => {
              const s = services.find((x) => x.name === e.target.value);
              onChange({ name: e.target.value, type: s?.types[0] });
            }}
            className="border border-border rounded px-2 py-1 flex-1">
            <option value="">선택…</option>
            {services.map((s) => <option key={s.name} value={s.name}>{s.name}</option>)}
          </select>
        </div>
      ) : isAction ? (
        <div className="space-y-2 text-sm">
          <input value={widget.name ?? ""} onChange={(e) => onChange({ name: e.target.value })}
            placeholder="/action 이름" className="border border-border rounded px-2 py-1 w-full font-mono text-xs" />
          <input value={widget.type ?? ""} onChange={(e) => onChange({ type: e.target.value })}
            placeholder="pkg/action/Type" className="border border-border rounded px-2 py-1 w-full font-mono text-xs" />
        </div>
      ) : (
        <div className="flex items-center gap-2 text-sm">
          토픽:
          <select value={selected}
            onChange={(e) => {
              const t = topics.find((x) => x.name === e.target.value);
              if (isControl) onChange({ name: e.target.value, type: t?.types[0] });
              else if (isImage) onChange({ topic: e.target.value, type: t?.types[0] });
              else onChange({ topic: e.target.value });
            }}
            className="border border-border rounded px-2 py-1 flex-1">
            <option value="">선택…</option>
            {topics.map((t) => <option key={t.name} value={t.name}>{t.name}</option>)}
          </select>
        </div>
      )}
      {(isControl || isService) && widget.type && <div className="text-xs text-muted">타입: {widget.type}</div>}
      {widget.kind === "diagnostics" && (
        <input value={widget.hardware_id_filter ?? ""} placeholder="hardware_id 필터 (예: can2)"
          onChange={(e) => onChange({ hardware_id_filter: e.target.value })}
          className="border border-border rounded px-2 py-1 text-sm w-full" />
      )}
    </div>
  );
}
