/** 녹화 도구 (역량 K, 데이터 자산화) — 토픽/진단/시스템을 CSV로 풀레이트 녹화. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tb } from "../client.js";
import { ok, humanizeError } from "../util.js";

export function registerRecorder(server: McpServer) {
  server.registerTool(
    "start_recording",
    {
      title: "녹화 시작",
      description: "토픽/진단/시스템 데이터를 백엔드에서 풀레이트로 CSV 녹화 시작. 테스트 측정 기록용.",
      inputSchema: {
        name: z.string().default("").describe("녹화 이름(파일명에 사용)"),
        topics: z
          .array(z.object({ topic: z.string(), msgType: z.string() }))
          .default([])
          .describe("녹화할 토픽들 [{topic, msgType}]"),
        diagnostics: z.boolean().default(false),
        system: z.boolean().default(false),
      },
    },
    async ({ name, topics, diagnostics, system }) => {
      try {
        const r = await tb.post<any>("/api/recordings/start", { name, topics, diagnostics, system });
        return ok(`녹화 시작: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "stop_recording",
    {
      title: "녹화 중지",
      description: "진행 중인 녹화 세션을 id로 중지(→ CSV 확정).",
      inputSchema: { id: z.string() },
    },
    async ({ id }) => {
      try {
        const r = await tb.post<any>("/api/recordings/stop", { id });
        return ok(`녹화 중지: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "recording_status",
    { title: "진행 중 녹화", description: "현재 녹화 중인 세션 목록.", inputSchema: {} },
    async () => {
      try {
        const r = await tb.get<any>("/api/recordings/active");
        return ok(JSON.stringify(r));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "list_recordings",
    {
      title: "녹화 파일 목록",
      description: "저장된 녹화(CSV) 목록 + 다운로드 URL.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await tb.get<any[]>("/api/recordings");
        if (!r?.length) return ok("저장된 녹화가 없습니다.");
        return ok(
          r
            .map((x: any) => {
              const fn = x.filename ?? x.name ?? x;
              return `- ${fn}  → ${tb.base}/api/recordings/${encodeURIComponent(fn)}/download`;
            })
            .join("\n"),
        );
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );
}
