/**
 * 화면 열기 — 기존 프론트엔드(테스트벤치 웹 UI)를 브라우저로 연다.
 * 별도 페이지를 만들지 않고, 이미 잘 구성된 프론트엔드 화면(스냅샷)으로 딥링크한다.
 * 워크스페이스는 ?snapshot=<이름> 딥링크를 지원(frontend/app/workspace/page.tsx).
 * MCP가 사용자 PC에서 로컬 실행되므로 OS 기본 브라우저를 직접 띄운다.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tb } from "../client.js";
import { ok, humanizeError, osOpen } from "../util.js";

const snapUrl = (name: string) => `${tb.base}/workspace?snapshot=${encodeURIComponent(name)}`;

export function registerView(server: McpServer) {
  server.registerTool(
    "list_views",
    {
      title: "저장된 화면 목록",
      description: "프론트엔드에 저장된 화면(스냅샷) 목록 — 카메라/텔레옵/내비/옆문 제어 등. open_view로 연다.",
      inputSchema: {},
    },
    async () => {
      try {
        const snaps = await tb.get<Array<{ name: string }>>("/api/snapshots");
        if (!snaps?.length) return ok("저장된 화면이 없습니다.");
        return ok("저장된 화면:\n" + snaps.map((s) => `- ${s.name}`).join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "open_view",
    {
      title: "화면 열기",
      description:
        "기존 웹 UI의 저장된 화면(스냅샷)을 브라우저로 연다. 이름은 list_views로 확인(예: Camera, Usbhub, Teleop, Navigation, 옆문 제어). 이름 없으면 대시보드를 연다.",
      inputSchema: { snapshot: z.string().optional().describe("스냅샷 이름(없으면 대시보드)") },
    },
    async ({ snapshot }) => {
      try {
        const url = snapshot ? snapUrl(snapshot) : tb.base;
        osOpen(url);
        return ok(`🌐 화면을 열었습니다: ${snapshot ?? "대시보드"}\n${url}`);
      } catch (e) {
        return ok(`브라우저 열기 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "open_camera_view",
    {
      title: "카메라 화면 열기",
      description:
        "기존 웹 UI의 카메라 화면을 브라우저로 연다(라이브 영상, 다중 카메라 선택 가능). 카메라 전원 on/off는 'Usbhub' 화면(open_view) 사용.",
      inputSchema: {},
    },
    async () => {
      try {
        osOpen(snapUrl("Camera"));
        return ok(
          `📷 카메라 화면을 열었습니다(웹 UI).\n카메라가 꺼져 있으면 먼저 'run_launch'로 카메라 런치를 켜세요. 개별 전원 on/off는 'Usbhub' 화면(open_view 'Usbhub')에서.`,
        );
      } catch (e) {
        return ok(`브라우저 열기 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "open_web_ui",
    {
      title: "웹 UI 열기",
      description: "테스트벤치 웹 UI 대시보드를 브라우저로 연다.",
      inputSchema: {},
    },
    async () => {
      try {
        osOpen(tb.base);
        return ok(`🌐 웹 UI를 열었습니다: ${tb.base}`);
      } catch (e) {
        return ok(`브라우저 열기 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  // ── 스냅샷 조합(테스트별 화면 재구성) ──
  server.registerTool(
    "get_view",
    {
      title: "화면 구성 조회",
      description: "저장된 화면(스냅샷)의 패널 구성을 조회. 조합/검토용.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      try {
        const doc = await tb.get<any>(`/api/snapshots/${encodeURIComponent(name)}`);
        const panels = doc?.data?.panels ?? [];
        return ok(
          `'${name}' (${panels.length}개 패널):\n` +
            panels.map((p: any) => `- ${p.type}${p.topic ? ` ${p.topic}` : ""}${p.cmdTopic ? ` cmd:${p.cmdTopic}` : ""}`).join("\n"),
        );
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "compose_view",
    {
      title: "테스트 화면 조합",
      description:
        "기존 화면(스냅샷) 여러 개의 패널을 합쳐 테스트용 새 화면을 만들고(저장) 연다. 예: 옆문 제어 + 모터 전류 + 카메라 → '옆문내구성'.",
      inputSchema: {
        name: z.string().describe("새 화면 이름(테스트명)"),
        sources: z.array(z.string()).describe("합칠 기존 스냅샷 이름들"),
        cols: z.number().default(2).describe("열 수(1~3)"),
        open: z.boolean().default(true).describe("만든 뒤 브라우저로 열기"),
      },
    },
    async ({ name, sources, cols, open }) => {
      try {
        const panels: any[] = [];
        const missing: string[] = [];
        for (const s of sources) {
          try {
            const doc = await tb.get<any>(`/api/snapshots/${encodeURIComponent(s)}`);
            panels.push(...(doc?.data?.panels ?? []));
          } catch {
            missing.push(s);
          }
        }
        if (!panels.length)
          return ok(`패널을 못 모았습니다(없는 스냅샷: ${missing.join(", ") || "?"}).`);
        await tb.post("/api/snapshots", { name, data: { cols, panels } });
        if (open) osOpen(snapUrl(name));
        return ok(
          `🧩 '${name}' 생성: ${sources.length}개 화면에서 패널 ${panels.length}개 조합${missing.length ? ` (누락: ${missing.join(", ")})` : ""}.` +
            (open ? " 브라우저로 열었습니다." : " open_view로 열 수 있습니다."),
        );
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "save_view",
    {
      title: "화면 저장",
      description: "현재 패널 구성을 스냅샷으로 저장(직접 data 지정). 보통은 compose_view 사용.",
      inputSchema: {
        name: z.string(),
        cols: z.number().default(2),
        panels: z.array(z.record(z.any())).default([]),
      },
    },
    async ({ name, cols, panels }) => {
      try {
        await tb.post("/api/snapshots", { name, data: { cols, panels } });
        return ok(`저장됨: ${name} (패널 ${panels.length}개)`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "delete_view",
    {
      title: "화면 삭제",
      description: "저장된 화면(스냅샷)을 삭제. 테스트용 임시 화면 정리에.",
      inputSchema: { name: z.string(), confirm: z.boolean().default(false) },
    },
    async ({ name, confirm }) => {
      if (!confirm) return ok(`'${name}' 삭제하려면 confirm=true.`);
      try {
        await tb.del(`/api/snapshots/${encodeURIComponent(name)}`);
        return ok(`삭제됨: ${name}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );
}
