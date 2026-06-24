/**
 * 범용 ROS 명령 — 임의 publish / service / action (고급).
 * 임의 명령은 로봇을 움직일 수 있으므로 쓰기 동작은 confirm 필수 + 정지 래치 확인.
 * 필드를 모르면 describe_command로 먼저 조회.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tb } from "../client.js";
import { latch } from "../latch.js";
import { ok, humanizeError } from "../util.js";

const latchBlock = "⛔ 정지 래치가 걸려 있어 실행할 수 없습니다. 'reset_estop' 후 다시 시도하세요.";

export function registerRos(server: McpServer) {
  server.registerTool(
    "list_services",
    { title: "서비스 목록", description: "현재 라이브 서비스 목록.", inputSchema: {} },
    async () => {
      try {
        const r = await tb.get<any[]>("/api/services");
        const names = r.map((s: any) => (typeof s === "string" ? s : s.name ?? s.service ?? JSON.stringify(s)));
        return ok(`서비스 ${names.length}개:\n` + names.sort().join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "list_actions",
    { title: "액션 목록", description: "현재 라이브 액션 목록.", inputSchema: {} },
    async () => {
      try {
        const r = await tb.get<any[]>("/api/actions");
        const names = r.map((a: any) => a.action ?? a.name ?? JSON.stringify(a));
        return ok(`액션 ${names.length}개:\n` + names.sort().join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "publish",
    {
      title: "토픽 발행(고급·승인 필수)",
      description:
        "임의 토픽에 메시지 1회 발행. 로봇을 움직일 수 있어 confirm 필수. 필드는 describe_command(kind=topic)로 확인.",
      inputSchema: {
        topic: z.string(),
        type: z.string().describe("메시지 타입 예: std_msgs/msg/String"),
        data: z.record(z.any()).default({}).describe("메시지 본문(dict)"),
        confirm: z.boolean().default(false),
      },
    },
    async ({ topic, type, data, confirm }) => {
      if (latch.engaged) return ok(latchBlock);
      if (!confirm)
        return ok(`📤 발행 예정: ${topic} (${type}) = ${JSON.stringify(data)}\n로봇 동작을 유발할 수 있습니다. 승인 시 confirm=true.`);
      try {
        await tb.post("/api/publish", { topic, type, data });
        return ok(`발행 완료: ${topic}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "call_service",
    {
      title: "서비스 호출(고급·승인 필수)",
      description:
        "임의 서비스 호출. 로봇 상태를 바꿀 수 있어 confirm 필수. 필드는 describe_command(kind=service)로 확인.",
      inputSchema: {
        name: z.string(),
        type: z.string().describe("서비스 타입"),
        request: z.record(z.any()).default({}),
        confirm: z.boolean().default(false),
      },
    },
    async ({ name, type, request, confirm }) => {
      if (latch.engaged) return ok(latchBlock);
      if (!confirm)
        return ok(`🛎 호출 예정: ${name} (${type}) req=${JSON.stringify(request)}\n승인 시 confirm=true.`);
      try {
        const r = await tb.post<any>("/api/service", { name, type, request }, 15000);
        return ok(`응답: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "send_action",
    {
      title: "액션 전송(고급·승인 필수)",
      description:
        "임의 액션 goal 전송(주행/도킹 등 장시간 동작 유발 가능) → confirm 필수. 필드는 describe_command(kind=action)로 확인. 취소는 cancel_action.",
      inputSchema: {
        name: z.string(),
        type: z.string(),
        goal: z.record(z.any()).default({}),
        confirm: z.boolean().default(false),
      },
    },
    async ({ name, type, goal, confirm }) => {
      if (latch.engaged) return ok(latchBlock);
      if (!confirm)
        return ok(`🎯 액션 전송 예정: ${name} (${type}) goal=${JSON.stringify(goal)}\n장시간 동작을 유발할 수 있습니다. 정지버튼 확인 후 confirm=true.`);
      try {
        const r = await tb.post<any>("/api/action", { name, type, goal }, 20000);
        return ok(`전송: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "cancel_action",
    {
      title: "액션 취소",
      description: "goal_id로 액션 취소.",
      inputSchema: { goal_id: z.string() },
    },
    async ({ goal_id }) => {
      try {
        const r = await tb.post<any>("/api/action/cancel", { goal_id });
        return ok(`취소: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );
}
