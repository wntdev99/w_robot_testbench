/**
 * 로그 도구 — (1) 범용 신호 로거: 아무 토픽이나 연속 기록 후 채팅에서 tail/분석.
 *            (2) 세션 이벤트 로그: 도구 실행/이벤트 자동 기록을 조회.
 * 저장 위치: W_ROBOT_LOG_DIR(기본 ~/w_robot_logs).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { WsHub } from "../realtime.js";
import { ok } from "../util.js";
import {
  LOG_DIR,
  startSignalLog,
  stopSignalLog,
  signalStatus,
  listLogs,
  resolveLog,
  tailFile,
  analyzeLog,
  logEvent,
} from "../logstore.js";

export function registerLogs(server: McpServer, hub: WsHub) {
  server.registerTool(
    "start_signal_log",
    {
      title: "신호 로깅 시작",
      description:
        "지정한 토픽(들)을 파일에 연속 기록 시작(30s 링버퍼 제한 없음). 흔들기/주행/장시간 테스트에. 끝나면 stop_signal_log. 예: ['/can_bms/status'].",
      inputSchema: {
        topics: z.array(z.string()).min(1).describe("기록할 토픽들"),
        name: z.string().default("").describe("로그 이름(파일명에 사용)"),
      },
    },
    async ({ topics, name }) => {
      try {
        for (const t of topics) {
          if (!hub.watched().includes(t)) {
            try {
              await hub.subscribe(t);
            } catch (e) {
              return ok(`토픽 구독 실패: ${t} — ${e instanceof Error ? e.message : String(e)} (미발행일 수 있음)`);
            }
          }
        }
        const s = startSignalLog(name, topics);
        return ok(
          `📝 신호 로깅 시작: ${topics.join(", ")}\n파일: ${s.file}\n중지: stop_signal_log · 진행 중 확인: signal_log_status`,
        );
      } catch (e) {
        return ok(`로깅 시작 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "stop_signal_log",
    { title: "신호 로깅 중지", description: "진행 중인 신호 로깅을 중지하고 토픽별 기록 수를 요약.", inputSchema: {} },
    async () => {
      const s = stopSignalLog();
      if (!s) return ok("진행 중인 신호 로깅이 없습니다.");
      const dur = Math.round((Date.now() - s.startedAt) / 1000);
      const lines = Object.entries(s.counts).map(([t, c]) => `  - ${t}: ${c}개`);
      return ok(`⏹ 로깅 중지 (${dur}s)\n파일: ${s.file}\n${lines.join("\n") || "  (기록된 샘플 없음)"}\n분석: analyze_log`);
    },
  );

  server.registerTool(
    "signal_log_status",
    { title: "신호 로깅 상태", description: "현재 신호 로깅 중인지·토픽·누적 샘플 수.", inputSchema: {} },
    async () => {
      const s = signalStatus();
      if (!s) return ok("신호 로깅 중이 아닙니다.");
      const dur = Math.round((Date.now() - s.startedAt) / 1000);
      const lines = [...s.topics].map((t) => `  - ${t}: ${s.counts[t] ?? 0}개`);
      return ok(`🟢 로깅 중 '${s.name}' (${dur}s)\n${lines.join("\n")}\n파일: ${s.file}`);
    },
  );

  server.registerTool(
    "list_logs",
    {
      title: "로그 파일 목록",
      description: `저장된 로그 파일 목록(신호 로그 + 세션 이벤트 로그). 위치: ${LOG_DIR}`,
      inputSchema: {},
    },
    async () => {
      const l = listLogs();
      if (!l.length) return ok(`로그 없음. (${LOG_DIR})`);
      return ok(
        `로그 ${l.length}개 (${LOG_DIR}):\n` +
          l
            .slice(0, 30)
            .map((x) => `- ${x.name}  (${(x.size / 1024).toFixed(1)}KB)`)
            .join("\n"),
      );
    },
  );

  server.registerTool(
    "tail_log",
    {
      title: "로그 보기(tail)",
      description: "로그 파일의 마지막 N줄을 본다. file 미지정 시 진행 중 신호로그 → 가장 최근 파일. 이벤트 로그도 가능.",
      inputSchema: {
        file: z.string().optional().describe("파일명(list_logs의 이름). 미지정 시 최근"),
        lines: z.number().default(20).describe("끝에서 몇 줄"),
      },
    },
    async ({ file, lines }) => {
      const path = resolveLog(file);
      if (!path) return ok("볼 로그가 없습니다. list_logs로 확인하세요.");
      const rows = tailFile(path, lines);
      if (!rows.length) return ok(`'${path.split("/").pop()}' 비어있음/없음.`);
      return ok(`${path.split("/").pop()} (마지막 ${rows.length}줄):\n` + rows.join("\n"));
    },
  );

  server.registerTool(
    "analyze_log",
    {
      title: "신호 로그 분석",
      description:
        "신호 로그를 분석: 토픽별 샘플수·구간·Hz. field 지정 시 그 값의 변화/전이 집계(예: field='alive' → 1↔0 전이, field='present_count'). 끊김/에러 횟수 셀 때.",
      inputSchema: {
        file: z.string().optional().describe("파일명(미지정 시 최근)"),
        field: z.string().optional().describe("값 경로(예: alive, present_count, rx_packets)"),
      },
    },
    async ({ file, field }) => {
      const path = resolveLog(file);
      if (!path) return ok("분석할 로그가 없습니다.");
      const r = analyzeLog(path, field);
      if ((r as any).error) return ok((r as any).error);
      return ok(JSON.stringify(r, null, 2));
    },
  );

  server.registerTool(
    "view_events",
    {
      title: "세션 이벤트 로그 보기",
      description: "MCP가 실행한 도구·이벤트(주행/정지/에러/보정 등)의 시간순 기록을 본다. '오늘 뭐 했는지' 감사·복기용.",
      inputSchema: { lines: z.number().default(30).describe("끝에서 몇 줄") },
    },
    async ({ lines }) => {
      const path = resolveLog(`events-${new Date().toISOString().slice(0, 10)}.jsonl`);
      const rows = path ? tailFile(path, lines) : [];
      if (!rows.length) return ok("오늘 이벤트 로그가 비어있습니다.");
      // 사람이 읽기 쉽게 요약
      const pretty = rows.map((l) => {
        try {
          const o = JSON.parse(l);
          const tm = (o.t || "").slice(11, 19);
          const d = o.detail ? ` ${JSON.stringify(o.detail).slice(0, 160)}` : "";
          return `${tm} [${o.kind}]${d}`;
        } catch {
          return l;
        }
      });
      return ok(`세션 이벤트 (마지막 ${rows.length}):\n` + pretty.join("\n"));
    },
  );

  // 이벤트 로거가 살아있음을 기록(시작 마커)
  logEvent("logs_tool_ready");
}
