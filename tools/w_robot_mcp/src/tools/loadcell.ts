/**
 * 로드셀(힘 측정) — 별도 설치 서버(01_loadcell, Phidget). 테스트 가압 측정용.
 * LOADCELL_BASE(.mcpb user_config)로 주소 지정. 로봇 PC(202)에 두면 LAN에서 공용 측정 가능.
 * API: GET /api/state·/api/reading(total kg)·/api/calib, POST /api/tare(영점).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { loadcell } from "../client.js";
import { ok } from "../util.js";

function lcError(e: unknown): string {
  return `로드셀 서버에 연결이 안 돼요(${loadcell.base}). 로드셀 서버(loadcell_server.py)가 켜져 있는지, 주소가 맞는지 확인하세요. [${e instanceof Error ? e.message : String(e)}]`;
}

export function registerLoadcell(server: McpServer) {
  server.registerTool(
    "loadcell_status",
    {
      title: "로드셀 상태",
      description: "로드셀 서버 연결·모듈·보정 상태 확인. 테스트 가압 전 준비 점검.",
      inputSchema: {},
    },
    async () => {
      try {
        const s = await loadcell.get<any>("/api/state", 3000);
        if (!s?.connected)
          return ok(`로드셀 서버는 응답하나 장치 미연결. 로드셀 GUI에서 [연결] 후 영점/보정하세요. (${loadcell.base})`);
        return ok(`로드셀 연결됨 ✅ 모듈=${s.module ?? "?"} serial=${s.serial ?? "?"} ch_max=${s.ch_max}kg`);
      } catch (e) {
        return ok(lcError(e));
      }
    },
  );

  server.registerTool(
    "get_loadcell_reading",
    {
      title: "로드셀 측정값",
      description: "현재 측정 무게(kg)를 읽는다. total=합계, ch=코너 4개. 가압 시점 캡처용.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await loadcell.get<any>("/api/reading", 3000);
        if (!r?.connected) return ok(`로드셀 미연결: ${r?.error ?? "연결 필요"}`);
        return ok(
          `무게: **${r.total?.toFixed ? r.total.toFixed(2) : r.total} kg**` +
            (r.ch ? ` (코너 ${r.ch.join(", ")} kg)` : "") +
            (r.over ? " ⚠ 채널 한계 초과" : ""),
        );
      } catch (e) {
        return ok(lcError(e));
      }
    },
  );

  server.registerTool(
    "loadcell_tare",
    {
      title: "로드셀 영점(승인 필수)",
      description: "로드셀을 영점(0) 잡는다. 가압 전 무부하 상태에서 1회. confirm 필수.",
      inputSchema: { confirm: z.boolean().default(false) },
    },
    async ({ confirm }) => {
      if (!confirm) return ok("영점은 무부하(아무것도 안 올린) 상태에서. 맞으면 confirm=true.");
      try {
        const r = await loadcell.post<any>("/api/tare", {}, 5000);
        return ok(`영점 완료: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(lcError(e));
      }
    },
  );
}
