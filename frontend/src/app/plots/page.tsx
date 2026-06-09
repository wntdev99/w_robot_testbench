"use client";
import { useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { api } from "@/lib/api";
import { useTb } from "@/lib/store";
import { Card, CardTitle } from "@/components/Card";
import { PlotPanel, PlotSample } from "@/components/PlotPanel";
import { cn } from "@/lib/cn";

type Topic = { topic: string; types: string[]; publishers: number; subscribers: number; plottable: boolean };
type Field = { path: string; base_type: string; array: boolean; plottable: boolean };

const getPath = (obj: any, path: string) =>
  path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
const num = (v: any): number | null =>
  typeof v === "number" ? v : typeof v === "boolean" ? (v ? 1 : 0) : null;

export default function PlotsPage() {
  const { topicData, subscribe, unsubscribe } = useTb((s) => ({
    topicData: s.topicData, subscribe: s.subscribe, unsubscribe: s.unsubscribe,
  }));
  const [topics, setTopics] = useState<Topic[]>([]);
  const [onlyPlottable, setOnlyPlottable] = useState(true);
  const [showHidden, setShowHidden] = useState(false);
  const [loading, setLoading] = useState(false);

  const [sel, setSel] = useState("");
  const [fields, setFields] = useState<Field[]>([]);
  const [chosen, setChosen] = useState<Set<string>>(new Set());

  const refresh = async () => {
    setLoading(true);
    try { setTopics(await api.topics(showHidden)); } catch { /* */ } finally { setLoading(false); }
  };
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [showHidden]);

  const visibleTopics = topics.filter((t) => (onlyPlottable ? t.plottable : true));

  const onSelect = async (topic: string) => {
    if (sel) unsubscribe(sel);
    setSel(topic); setFields([]); setChosen(new Set());
    if (!topic) return;
    const type = topics.find((x) => x.topic === topic)?.types[0];
    try {
      const res = await api.topicFields(topic, type);
      const pf = res.plottable_fields;
      setFields(pf);
      setChosen(new Set(pf.slice(0, 4).map((f) => f.path))); // 기본 상위 4개 선택
      subscribe(topic, res.type);
    } catch {
      subscribe(topic, type);
    }
  };

  const toggleField = (p: string) =>
    setChosen((prev) => {
      const n = new Set(prev);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  // 선택 필드 + 최신 샘플 → 시리즈(라벨/값). 배열 필드는 인덱스로 전개.
  const sample = sel ? topicData[sel] : undefined;
  const { labels, latest } = useMemo(() => {
    const lbls: string[] = [];
    const vals: (number | null)[] = [];
    for (const f of fields) {
      if (!chosen.has(f.path)) continue;
      const v = sample ? getPath(sample.values, f.path) : undefined;
      if (f.array) {
        const arr = Array.isArray(v) ? v : [];
        arr.forEach((x, i) => { lbls.push(`${f.path}[${i}]`); vals.push(num(x)); });
      } else {
        lbls.push(f.path); vals.push(num(v));
      }
    }
    return { labels: lbls, latest: sample && lbls.length ? { t: sample.ts, vals } as PlotSample : null };
  }, [fields, chosen, sample]);

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">측정 · 플롯</h1>

      <Card>
        <div className="flex items-center justify-between mb-3">
          <CardTitle>
            토픽 선택 <span className="text-xs font-normal text-ink-faint">({visibleTopics.length}개)</span>
          </CardTitle>
          <div className="flex items-center gap-3 text-xs text-ink-soft">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={onlyPlottable} onChange={(e) => setOnlyPlottable(e.target.checked)} />
              플롯 가능만
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
              내부/액션 포함
            </label>
            <button onClick={refresh} className="flex items-center gap-1.5 rounded-lg bg-surface-muted px-3 py-1.5 font-medium hover:bg-surface-line">
              <RefreshCw size={13} className={cn(loading && "animate-spin")} /> 새로고침
            </button>
          </div>
        </div>

        <select value={sel} onChange={(e) => onSelect(e.target.value)}
          className="w-full rounded-xl border border-surface-line bg-surface px-3 py-2 text-sm">
          <option value="">토픽을 선택하세요…</option>
          {visibleTopics.map((t) => (
            <option key={t.topic} value={t.topic} disabled={t.publishers === 0}>
              {t.topic} — {t.types[0]} {t.publishers === 0 ? "(발행자 없음)" : `(pub ${t.publishers})`}
            </option>
          ))}
        </select>
      </Card>

      {sel && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <CardTitle>{sel}</CardTitle>
          </div>

          {/* 타입에서 미리 뽑은 수치 필드 — 골라서 플롯 */}
          {fields.length > 0 ? (
            <div className="mb-4 flex flex-wrap gap-2">
              {fields.map((f) => (
                <label key={f.path}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs cursor-pointer",
                    chosen.has(f.path) ? "border-brand-500 bg-brand-50 text-brand-700" : "border-surface-line text-ink-soft",
                  )}>
                  <input type="checkbox" checked={chosen.has(f.path)} onChange={() => toggleField(f.path)} className="hidden" />
                  {f.path}<span className="text-ink-faint">{f.array ? " []" : ""} {f.base_type}</span>
                </label>
              ))}
            </div>
          ) : (
            <div className="mb-2 text-sm text-warn">이 메시지 타입엔 플롯 가능한 수치 필드가 없습니다.</div>
          )}

          {labels.length > 0 ? (
            <PlotPanel title="" seriesLabels={labels} latest={latest} windowSec={30} height={300} />
          ) : fields.length > 0 ? (
            <div className="text-sm text-ink-faint">
              필드 선택됨 · 메시지 수신 시 플롯 시작{sample ? "" : " (데이터 대기 중)"}
            </div>
          ) : null}
        </Card>
      )}
    </div>
  );
}
