/** 관리자 — 시작 플랜 조회/대기상태. 파괴적 적용/종료는 ALLOW_DESTRUCTIVE 게이트. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tb } from "../client.js";
import { ALLOW_DESTRUCTIVE } from "../config.js";
import { ok, humanizeError } from "../util.js";

export function registerAdmin(server: McpServer) {
  server.registerTool(
    "admin_status",
    {
      title: "시작 플랜 상태",
      description: "부팅 시작 플랜 대기 여부(startup_pending)와 플랜.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await tb.get<any>("/api/admin/status");
        return ok(`startup_pending: ${r.startup_pending}\nplan: ${JSON.stringify(r.plan)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "get_startup_plan",
    { title: "시작 플랜 조회", description: "저장된 시작 플랜 내용.", inputSchema: {} },
    async () => {
      try {
        return ok(JSON.stringify(await tb.get<any>("/api/admin/plan"), null, 2));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "dismiss_startup",
    {
      title: "시작 플랜 건너뛰기",
      description: "대기 중인 시작 플랜을 실행 없이 해제(비파괴적).",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(`건너뜀: ${JSON.stringify(await tb.post<any>("/api/admin/dismiss"))}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  // 파괴적: 기존 ros2 종료 + baseline 기동. 기본 비활성.
  if (ALLOW_DESTRUCTIVE) {
    server.registerTool(
      "apply_startup_plan",
      {
        title: "⚠ 시작 플랜 적용(관리자·파괴적)",
        description: "기존 ros2 일괄 종료 후 baseline을 순서대로 기동(파괴적). 관리자 전용.",
        inputSchema: { confirm: z.boolean().default(false) },
      },
      async ({ confirm }) => {
        if (!confirm)
          return ok("🛑 파괴적: 기존 ros2를 모두 끄고 시작 플랜을 기동합니다. confirm=true 필요.");
        try {
          return ok(`적용 시작: ${JSON.stringify(await tb.post<any>("/api/admin/apply"))}`);
        } catch (e) {
          return ok(humanizeError(e));
        }
      },
    );
  }
}
