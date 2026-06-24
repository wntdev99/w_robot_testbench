/** 내비게이션 시각화 — 맵 정보/이미지 + 오버레이(scan/footprint/pose). */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { getBinary, tb } from "../client.js";
import { ok, humanizeError } from "../util.js";

export function registerNav(server: McpServer) {
  server.registerTool(
    "nav_map_info",
    {
      title: "맵 정보",
      description: "내비 맵 메타(해상도/크기/원점)와 사용 가능 여부.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await tb.get<any>("/api/nav/map/meta");
        return ok(r.available ? JSON.stringify(r) : "맵 없음(map_server 미기동?).");
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "nav_map_image",
    {
      title: "맵 이미지 보기",
      description: "내비 맵을 PNG 이미지로 표시.",
      inputSchema: {},
    },
    async () => {
      try {
        const img = await getBinary("/api/nav/map.png");
        if (!img) return ok("맵 이미지가 없습니다(map_server 미기동?).");
        return {
          content: [
            { type: "text" as const, text: "🗺 내비 맵" },
            { type: "image" as const, data: img.base64, mimeType: img.contentType },
          ],
        };
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "nav_overlay",
    {
      title: "맵 오버레이 데이터",
      description: "맵 위 scan/footprint/로봇 pose 등 오버레이 좌표 데이터.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await tb.get<any>("/api/nav/overlay");
        return ok(JSON.stringify(r));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );
}
