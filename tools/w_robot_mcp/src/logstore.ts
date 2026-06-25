/**
 * 로그 저장소 — (1) 범용 신호 로거(토픽 연속 기록) (2) 세션 이벤트 로그(도구 실행 자동 기록).
 * 파일은 W_ROBOT_LOG_DIR(기본 ~/w_robot_logs)에 JSONL로 저장. 30s 링버퍼와 달리 길이 제한 없음.
 */
import { appendFileSync, mkdirSync, readdirSync, statSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const LOG_DIR = process.env.W_ROBOT_LOG_DIR || join(homedir(), "w_robot_logs");
function ensureDir() {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    /* ignore */
  }
}
const iso = () => new Date().toISOString();
const safe = (s: string) => s.replace(/[^\w.\-가-힣]+/g, "_").slice(0, 60);

// ───────────────────────── 세션 이벤트 로그 ─────────────────────────
function eventFile() {
  return join(LOG_DIR, `events-${new Date().toISOString().slice(0, 10)}.jsonl`);
}
export function logEvent(kind: string, detail?: any) {
  ensureDir();
  try {
    appendFileSync(eventFile(), JSON.stringify({ t: iso(), kind, ...(detail !== undefined ? { detail } : {}) }) + "\n");
  } catch {
    /* 로깅 실패는 무시 — 본 기능을 막지 않는다 */
  }
}

// ───────────────────────── 범용 신호 로거 ─────────────────────────
type SignalSession = {
  name: string;
  file: string;
  topics: Set<string>;
  counts: Record<string, number>;
  startedAt: number;
};
let active: SignalSession | null = null;

export function startSignalLog(name: string, topics: string[]): SignalSession {
  ensureDir();
  const file = join(LOG_DIR, `${safe(name || "signal")}-${Date.now()}.jsonl`);
  active = { name: name || "signal", file, topics: new Set(topics), counts: {}, startedAt: Date.now() };
  try {
    appendFileSync(file, JSON.stringify({ t: iso(), ev: "start", topics }) + "\n");
  } catch {
    /* ignore */
  }
  logEvent("signal_log_start", { name: active.name, topics, file });
  return active;
}

/** WsHub.push 에서 호출 — 활성 세션의 토픽이면 파일에 한 줄 기록. */
export function signalOnPush(topic: string, v: any) {
  if (!active || !active.topics.has(topic)) return;
  active.counts[topic] = (active.counts[topic] || 0) + 1;
  try {
    appendFileSync(active.file, JSON.stringify({ t: Date.now(), topic, v }) + "\n");
  } catch {
    /* ignore */
  }
}

export function stopSignalLog(): SignalSession | null {
  if (!active) return null;
  const a = active;
  try {
    appendFileSync(a.file, JSON.stringify({ t: iso(), ev: "stop", counts: a.counts }) + "\n");
  } catch {
    /* ignore */
  }
  logEvent("signal_log_stop", { name: a.name, counts: a.counts, file: a.file });
  active = null;
  return a;
}

export function signalStatus(): SignalSession | null {
  return active;
}

// ───────────────────────── 조회 유틸 ─────────────────────────
export function listLogs() {
  ensureDir();
  try {
    return readdirSync(LOG_DIR)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const st = statSync(join(LOG_DIR, f));
        return { name: f, size: st.size, mtime: st.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    return [];
  }
}

/** 파일명 해석: 미지정 시 활성 신호로그 → 가장 최근 파일. */
export function resolveLog(name?: string): string | null {
  if (name) return join(LOG_DIR, name.replace(/[/\\]/g, ""));
  if (active) return active.file;
  const l = listLogs();
  return l.length ? join(LOG_DIR, l[0].name) : null;
}

export function tailFile(file: string, n: number): string[] {
  try {
    return readFileSync(file, "utf8").split(/\n/).filter(Boolean).slice(-n);
  } catch {
    return [];
  }
}

function getPath(obj: any, path: string): any {
  return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** 신호 로그 분석: 토픽별 샘플수·구간·Hz, 그리고 field 지정 시 값 변화/전이 집계. */
export function analyzeLog(file: string, field?: string) {
  let lines: string[];
  try {
    lines = readFileSync(file, "utf8").split(/\n/).filter(Boolean);
  } catch {
    return { error: "파일을 읽을 수 없습니다." };
  }
  const samples = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((o: any) => o && o.topic !== undefined && o.v !== undefined);
  if (!samples.length) return { error: "신호 샘플이 없습니다(이벤트 로그이거나 빈 파일)." };

  const byTopic: Record<string, { count: number; t0: number; t1: number }> = {};
  for (const s of samples) {
    const b = (byTopic[s.topic] ??= { count: 0, t0: s.t, t1: s.t });
    b.count++;
    b.t1 = s.t;
  }
  const topics = Object.entries(byTopic).map(([topic, b]) => {
    const sec = (b.t1 - b.t0) / 1000;
    return { topic, count: b.count, sec: Math.round(sec * 10) / 10, hz: sec > 0 ? Math.round((b.count / sec) * 10) / 10 : 0 };
  });

  let fieldReport: any = null;
  if (field) {
    const changes: Array<{ t: number; from: any; to: any }> = [];
    let prev: any;
    const nums: number[] = [];
    let first: any, last: any, n = 0;
    for (const s of samples) {
      const val = getPath(s.v, field);
      if (val === undefined) continue;
      if (n === 0) first = val;
      last = val;
      n++;
      if (typeof val === "number") nums.push(val);
      if (prev !== undefined && val !== prev) changes.push({ t: s.t, from: prev, to: val });
      prev = val;
    }
    fieldReport = {
      field,
      samples: n,
      first,
      last,
      changes: changes.length,
      ...(nums.length ? { min: Math.min(...nums), max: Math.max(...nums) } : {}),
      transitions: changes.slice(0, 30),
    };
  }
  return { file: file.split("/").pop(), totalLines: lines.length, topics, field: fieldReport };
}
