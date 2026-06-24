/** 실시간 도구 (M2) — WS 링버퍼 기반 최신값/구간/통계. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { ok } from "../util.js";
import { WsHub, flattenNumeric } from "../realtime.js";

export function registerRealtime(server: McpServer, hub: WsHub) {
  server.registerTool(
    "list_watched",
    {
      title: "구독 중 토픽",
      description: "현재 실시간 구독(링버퍼) 중인 토픽과 최신 수신 여부.",
      inputSchema: {},
    },
    async () => {
      const conn = hub.isConnected() ? "연결됨" : "연결 끊김(재연결 시도 중)";
      const rows = hub.watched().map((t) => {
        const l = hub.latest(t);
        const age = l ? `${Math.round((Date.now() - l.t) / 100) / 10}s 전` : "수신 없음";
        return `- ${t}: ${age}`;
      });
      return ok(`WS ${conn}\n` + (rows.join("\n") || "구독 없음"));
    },
  );

  server.registerTool(
    "subscribe_topic",
    {
      title: "토픽 구독 추가",
      description: "기본 외 토픽을 실시간 구독에 추가(타입 미지정 시 자동 조회).",
      inputSchema: { topic: z.string(), type: z.string().optional() },
    },
    async ({ topic, type }) => {
      try {
        await hub.subscribe(topic, type);
        return ok(`구독 추가: ${topic}. 잠시 후 get_latest/watch로 확인하세요.`);
      } catch (e) {
        return ok(e instanceof Error ? e.message : String(e));
      }
    },
  );

  server.registerTool(
    "unsubscribe_topic",
    {
      title: "토픽 구독 해제",
      description: "실시간 구독에서 토픽 제거.",
      inputSchema: { topic: z.string() },
    },
    async ({ topic }) => {
      hub.unsubscribe(topic);
      return ok(`구독 해제: ${topic}`);
    },
  );

  server.registerTool(
    "get_latest",
    {
      title: "최신값",
      description: "링버퍼의 토픽 최신 1개 샘플(원본).",
      inputSchema: { topic: z.string() },
    },
    async ({ topic }) => {
      const l = hub.latest(topic);
      if (!l)
        return ok(`'${topic}' 최근 데이터 없음. 구독 중인지(list_watched)·발행 중인지 확인.`);
      return ok(`(${Math.round((Date.now() - l.t) / 100) / 10}s 전)\n` + JSON.stringify(l.v));
    },
  );

  server.registerTool(
    "get_recent",
    {
      title: "최근 구간 샘플",
      description: "최근 N초 동안의 샘플(최대 50개로 다운샘플).",
      inputSchema: { topic: z.string(), seconds: z.number().default(5) },
    },
    async ({ topic, seconds }) => {
      const s = hub.recent(topic, seconds);
      if (!s.length) return ok(`'${topic}' 최근 ${seconds}초 데이터 없음.`);
      const step = Math.max(1, Math.floor(s.length / 50));
      const picked = s.filter((_, i) => i % step === 0);
      return ok(
        `${s.length}개 중 ${picked.length}개:\n` +
          picked.map((x) => `${new Date(x.t).toISOString().slice(11, 23)} ${JSON.stringify(x.v)}`).join("\n"),
      );
    },
  );

  server.registerTool(
    "watch",
    {
      title: "구간 추이/통계",
      description: "최근 N초 동안 수치 필드의 min/max/평균/최근값. 예: '5초간 joint effort 변화'.",
      inputSchema: { topic: z.string(), seconds: z.number().default(5) },
    },
    async ({ topic, seconds }) => {
      const samples = hub.recent(topic, seconds);
      if (!samples.length) return ok(`'${topic}' 최근 ${seconds}초 데이터 없음.`);
      const series = new Map<string, number[]>();
      for (const s of samples) {
        const flat = flattenNumeric(s.v);
        for (const [k, val] of Object.entries(flat)) {
          if (!series.has(k)) series.set(k, []);
          series.get(k)!.push(val);
        }
      }
      const lines = [`${topic} · ${samples.length}샘플 / ${seconds}초`];
      let n = 0;
      for (const [k, arr] of series) {
        if (n++ >= 24) {
          lines.push(`… (${series.size - 24}개 필드 생략)`);
          break;
        }
        const min = Math.min(...arr),
          max = Math.max(...arr),
          mean = arr.reduce((a, b) => a + b, 0) / arr.length,
          last = arr[arr.length - 1];
        const f = (x: number) => (Math.round(x * 1000) / 1000).toString();
        lines.push(`- ${k}: 최근 ${f(last)} (min ${f(min)} / max ${f(max)} / 평균 ${f(mean)})`);
      }
      return ok(lines.join("\n"));
    },
  );
}
