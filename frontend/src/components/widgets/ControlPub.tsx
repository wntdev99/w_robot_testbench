"use client";

import { useEffect, useState } from "react";
import { api, type FieldNode } from "@/lib/api";

// control.topic_pub 위젯 — 임의 메시지 타입 동적 폼(typeFields 재귀) → publish (부속 D §3.2).
export function ControlPub({ name, type }: { name: string; type: string }) {
  const [fields, setFields] = useState<Record<string, FieldNode> | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});

  useEffect(() => {
    if (!type) return;
    api.typeFields(type).then((r) => setFields(r.fields)).catch(() => setFields({}));
  }, [type]);

  const publish = () => api.publish(name, type, values).catch(() => {});
  const zero = () => { setValues({}); api.publish(name, type, {}).catch(() => {}); };

  return (
    <div className="space-y-2 text-sm">
      <div className="text-xs text-muted break-all">{name} · {type}</div>
      {fields ? (
        <div className="max-h-48 overflow-auto">
          <FieldForm fields={fields} value={values} onChange={setValues} />
        </div>
      ) : (
        <div className="text-muted text-xs">타입 로딩…</div>
      )}
      <div className="flex gap-2 pt-1">
        <button onClick={publish} className="px-3 py-1.5 rounded-card bg-primary text-white">발행</button>
        <button onClick={zero} className="px-3 py-1.5 rounded-card bg-surface border border-border">0 정지</button>
      </div>
    </div>
  );
}

function FieldForm({ fields, value, onChange }: {
  fields: Record<string, FieldNode>;
  value: Record<string, unknown>;
  onChange: (v: Record<string, unknown>) => void;
}) {
  const set = (k: string, v: unknown) => onChange({ ...value, [k]: v });
  return (
    <div className="space-y-1 pl-2 border-l border-border">
      {Object.entries(fields).map(([k, node]) =>
        node.fields ? (
          <details key={k} open>
            <summary className="text-xs text-muted cursor-pointer">{k} <span className="opacity-60">{node.type}</span></summary>
            <FieldForm fields={node.fields} value={(value[k] as Record<string, unknown>) ?? {}} onChange={(v) => set(k, v)} />
          </details>
        ) : (
          <label key={k} className="flex items-center justify-between gap-2">
            <span className="text-xs">{k} <span className="text-muted">{node.type}{node.array ? "[]" : ""}</span></span>
            <FieldInput node={node} value={value[k]} onChange={(v) => set(k, v)} />
          </label>
        ),
      )}
    </div>
  );
}

function FieldInput({ node, value, onChange }: { node: FieldNode; value: unknown; onChange: (v: unknown) => void }) {
  const numeric = /int|float|double|byte/.test(node.type);
  if (node.array) {
    return (
      <input className="border border-border rounded px-2 py-1 w-32 text-xs"
        placeholder="a,b,c"
        value={Array.isArray(value) ? (value as unknown[]).join(",") : ""}
        onChange={(e) => onChange(e.target.value.split(",").map((s) => (numeric ? +s : s)).filter((x) => x !== "" && !Number.isNaN(x)))} />
    );
  }
  if (node.type === "boolean" || node.type === "bool") {
    return <input type="checkbox" checked={!!value} onChange={(e) => onChange(e.target.checked)} />;
  }
  if (node.type === "string") {
    return <input className="border border-border rounded px-2 py-1 w-28 text-xs" value={(value as string) ?? ""} onChange={(e) => onChange(e.target.value)} />;
  }
  return <input type="number" step="any" className="border border-border rounded px-2 py-1 w-24 text-xs" value={(value as number) ?? 0} onChange={(e) => onChange(+e.target.value)} />;
}
