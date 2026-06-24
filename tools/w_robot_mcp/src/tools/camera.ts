/** 카메라 도구 — 켜진 카메라 목록 + 프레임 1장(이미지로 표시). */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getBinary, tb } from "../client.js";
import { ok, humanizeError, sleep } from "../util.js";

export function registerCamera(server: McpServer) {
  server.registerTool(
    "list_cameras",
    {
      title: "카메라 목록",
      description: "현재 영상이 나오는 카메라(이미지 토픽) 목록. 비어 있으면 카메라 드라이버가 안 떠 있는 것.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await tb.get<{ available: boolean; topics: string[] }>("/api/camera/topics");
        if (!r.available)
          return ok("백엔드에 영상 변환 의존성(cv2/cv_bridge)이 없어 카메라를 쓸 수 없습니다.");
        if (!r.topics?.length)
          return ok("켜진 카메라가 없습니다. 카메라 런치를 먼저 실행하세요(run_launch, 예: w_type_mw/multi_camera_standalone.launch.py).");
        return ok(`켜진 카메라 ${r.topics.length}대:\n` + r.topics.map((t) => `- ${t}`).join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "get_camera_frame",
    {
      title: "카메라 영상 보기",
      description: "지정 카메라(이미지 토픽)에서 프레임 1장을 가져와 이미지로 표시. topic은 list_cameras에서 확인.",
      inputSchema: { topic: z.string().describe("이미지 토픽 (예: /camera/color/image_raw)") },
    },
    async ({ topic }) => {
      try {
        const img = await getBinary(`/api/camera/frame?topic=${encodeURIComponent(topic)}&display=1`);
        if (!img)
          return ok(`'${topic}' 아직 프레임이 없습니다(구독 시작 직후일 수 있음). 잠시 후 다시 시도하세요.`);
        return {
          content: [
            { type: "text" as const, text: `📷 ${topic}` },
            { type: "image" as const, data: img.base64, mimeType: img.contentType },
          ],
        };
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  // 시간차 워크플로우용 — 카메라를 잠깐 켰다가 자동으로 끈다(인터넷 자동 복구).
  server.registerTool(
    "camera_on_temporarily",
    {
      title: "카메라 임시 켜기(자동 복구)",
      description:
        "카메라 런치를 켜고 N초 뒤 자동으로 끈다. 카메라 ON 동안 노트북 인터넷이 끊겨도, MCP가 로컬에서 끝까지 실행해 자동으로 꺼서 인터넷을 복구한다. " +
        "켜기 전 open_camera_view로 웹 UI를 먼저 띄워두면 그 사이 영상을 볼 수 있다. confirm 필수.",
      inputSchema: {
        package: z.string().default("w_type_mw"),
        file: z.string().default("multi_camera_standalone.launch.py"),
        machine: z.enum(["server", "controller"]).default("server"),
        seconds: z.number().default(30).describe("켜둘 시간(초, 5~300)"),
        confirm: z.boolean().default(false),
      },
    },
    async ({ package: pkg, file, machine, seconds, confirm }) => {
      const secs = Math.min(Math.max(seconds, 5), 300);
      if (!confirm)
        return ok(
          [
            `📷 임시 카메라 예정: '${pkg} ${file}' (${machine}) — ${secs}초 후 자동 종료.`,
            "⚠ 카메라가 켜지면 노트북 인터넷이 끊길 수 있습니다(공유기 포화). N초 뒤 자동으로 꺼서 복구됩니다.",
            "그 사이 영상을 보려면 먼저 open_camera_view로 웹 UI를 띄워두세요(인터넷 없어도 로컬에서 동작).",
            "승인 시 confirm=true.",
          ].join("\n"),
        );
      // 중복 가드 — 이미 같은 런치가 떠 있으면 건드리지 않음(남의 프로세스 정지 방지)
      const running = await tb
        .get<Array<{ package: string; file: string }>>(`/api/processes/running?machine=${machine}`, 15000)
        .catch(() => [] as any[]);
      if (running.find((r) => r.package === pkg && r.file === file))
        return ok(`이미 실행 중입니다 — 임시 켜기 안 함. 끄려면 stop_launch/웹 UI를 쓰세요.`);

      let rid: string | null = null;
      try {
        const started = await tb.post<any>("/api/launch/run", { machine, package: pkg, file, args: "" }, 20000);
        rid = started?.id ?? null;
        await sleep(secs * 1000); // 이 동안 인터넷이 끊겨도 MCP는 로컬이라 계속 진행
        return ok(
          `✅ 카메라를 ${secs}초간 켰다가 껐습니다. 인터넷이 복구됐을 겁니다.${rid ? ` (id ${rid})` : ""}`,
        );
      } catch (e) {
        return ok(`임시 카메라 중 오류: ${humanizeError(e)}`);
      } finally {
        // 무슨 일이 있어도 끈다 — 인터넷 복구 보장
        if (rid) await tb.post("/api/launch/stop", { id: rid }, 20000).catch(() => {});
      }
    },
  );
}
