/**
 * WS 허브 + 링버퍼 (설계 §3·§8).
 * 백엔드 /ws 에 클라이언트로 상시 연결 → topic_data/diagnostics 수신 → 토픽별 링버퍼(최근 N초).
 * 도구 호출과 독립적으로 백그라운드에서 버퍼를 채운다. 끊기면 백오프 재연결 + 재구독.
 */
import WebSocket from "ws";
import { tb } from "./client.js";
import { DEFAULT_SUBS, RING_SECONDS } from "./config.js";

type Sample = { t: number; v: any };

export class WsHub {
  private ws: WebSocket | null = null;
  private url: string;
  private buffers = new Map<string, Sample[]>();
  private subs = new Map<string, string>(); // topic -> type
  private latestDiag: any = null;
  private connected = false;
  private backoff = 1000;
  /** push 훅 — 신호 로거가 활성일 때 매 샘플을 파일로 흘려보낸다(logstore.signalOnPush). */
  onPush: ((topic: string, v: any) => void) | null = null;

  constructor() {
    // http(s)://host:port → ws(s)://host:port/ws
    this.url = tb.base.replace(/^http/, "ws") + "/ws";
  }

  start() {
    for (const s of DEFAULT_SUBS) this.subs.set(s.topic, s.type);
    this.connect();
  }

  private connect() {
    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.on("open", () => {
      this.connected = true;
      this.backoff = 1000;
      for (const [topic, type] of this.subs) this.sendSub(topic, type);
      console.error(`[w_robot_mcp] ws connected: ${this.url}`);
    });
    this.ws.on("message", (raw: WebSocket.RawData) => this.onMessage(raw));
    this.ws.on("close", () => {
      this.connected = false;
      this.scheduleReconnect();
    });
    this.ws.on("error", () => {
      try {
        this.ws?.close();
      } catch {
        /* noop */
      }
    });
  }

  private scheduleReconnect() {
    setTimeout(() => this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15000);
  }

  private sendSub(topic: string, type: string) {
    if (this.connected) this.ws?.send(JSON.stringify({ op: "sub", topic, type }));
  }

  private onMessage(raw: WebSocket.RawData) {
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }
    if (msg.type === "topic_data" && msg.data?.topic) {
      this.push(msg.data.topic, msg.data.values);
    } else if (msg.type === "diagnostics") {
      this.latestDiag = msg.data;
    } else if (msg.type === "welcome" && msg.data?.diagnostics) {
      this.latestDiag = msg.data.diagnostics;
    }
  }

  private push(topic: string, v: any) {
    const now = Date.now();
    let buf = this.buffers.get(topic);
    if (!buf) {
      buf = [];
      this.buffers.set(topic, buf);
    }
    buf.push({ t: now, v });
    const cutoff = now - RING_SECONDS * 1000;
    while (buf.length && buf[0].t < cutoff) buf.shift();
    if (this.onPush) {
      try {
        this.onPush(topic, v);
      } catch {
        /* 로깅 실패는 버퍼링을 막지 않는다 */
      }
    }
  }

  /** 동적 구독 추가(타입 미상이면 백엔드에 조회). */
  async subscribe(topic: string, type?: string) {
    let t = type;
    if (!t) {
      try {
        const r = await tb.get<{ type: string }>(
          `/api/topics/type?topic=${encodeURIComponent(topic)}`,
        );
        t = r.type;
      } catch {
        throw new Error(`토픽 타입을 알 수 없습니다(미발행?): ${topic}`);
      }
    }
    this.subs.set(topic, t);
    this.sendSub(topic, t);
  }

  unsubscribe(topic: string) {
    this.subs.delete(topic);
    this.buffers.delete(topic);
    if (this.connected) this.ws?.send(JSON.stringify({ op: "unsub", topic }));
  }

  isConnected() {
    return this.connected;
  }
  watched() {
    return [...this.subs.keys()];
  }
  latest(topic: string): Sample | null {
    const buf = this.buffers.get(topic);
    return buf && buf.length ? buf[buf.length - 1] : null;
  }
  recent(topic: string, seconds: number): Sample[] {
    const buf = this.buffers.get(topic);
    if (!buf) return [];
    const cutoff = Date.now() - seconds * 1000;
    return buf.filter((s) => s.t >= cutoff);
  }
  diagnostics() {
    return this.latestDiag;
  }
}

/** JointState 인지형 평탄화 → {경로: 숫자}. 도구에서 통계용. */
export function flattenNumeric(v: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (v && Array.isArray(v.name) && (v.position || v.velocity || v.effort)) {
    for (const field of ["position", "velocity", "effort"] as const) {
      const arr = v[field];
      if (Array.isArray(arr))
        v.name.forEach((n: string, i: number) => {
          if (typeof arr[i] === "number") out[`${field}[${n}]`] = arr[i];
        });
    }
    return out;
  }
  const walk = (obj: any, prefix: string, depth: number) => {
    if (depth > 3 || obj == null) return;
    if (typeof obj === "number") {
      out[prefix || "value"] = obj;
      return;
    }
    if (Array.isArray(obj)) {
      if (obj.length <= 16)
        obj.forEach((x, i) => walk(x, `${prefix}[${i}]`, depth + 1));
      return;
    }
    if (typeof obj === "object")
      for (const [k, val] of Object.entries(obj))
        walk(val, prefix ? `${prefix}.${k}` : k, depth + 1);
  };
  walk(v, "", 0);
  return out;
}
