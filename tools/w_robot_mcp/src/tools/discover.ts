/** 발견 도구 — 라이브 그래프 + 기대 카탈로그(설계 §3). 캐시하지 않음. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tb } from "../client.js";
import { ok, humanizeError } from "../util.js";

export function registerDiscover(server: McpServer) {
  server.registerTool(
    "list_controllers",
    {
      title: "컨트롤러 목록",
      description: "controller_manager 컨트롤러와 active/inactive. 주행하려면 swerve_controller가 active여야 함.",
      inputSchema: {},
    },
    async () => {
      try {
        const list = await tb.get<Array<{ name: string; state: string }>>("/api/controllers");
        if (!list.length) return ok("컨트롤러가 없습니다(컨트롤러 미기동?).");
        return ok(list.map((c) => `- ${c.name}: ${c.state}`).join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "list_topics",
    {
      title: "토픽 조회(라이브)",
      description: "현재 라이브 토픽 목록(캐시 안 함). 어떤 기능이 떠 있는지 확인.",
      inputSchema: { filter: z.string().optional().describe("부분 일치 필터(예: cmd_vel, joint)") },
    },
    async ({ filter }) => {
      try {
        const topics = await tb.get<Array<{ topic: string }>>("/api/topics");
        let names = topics.map((t) => t.topic);
        if (filter) names = names.filter((n) => n.includes(filter));
        names.sort();
        return ok(`토픽 ${names.length}개${filter ? ` (필터 '${filter}')` : ""}:\n` + names.join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "describe_command",
    {
      title: "명령 필드 조회",
      description: "토픽/서비스/액션의 입력 필드를 조회(폼 생성용). 인자를 모를 때 먼저 호출.",
      inputSchema: {
        kind: z.enum(["topic", "service", "action"]),
        name: z.string().describe("토픽/서비스/액션 이름"),
      },
    },
    async ({ kind, name }) => {
      try {
        const path =
          kind === "topic"
            ? `/api/topics/fields?topic=${encodeURIComponent(name)}`
            : kind === "service"
              ? `/api/services/fields?service=${encodeURIComponent(name)}`
              : `/api/actions/fields?action=${encodeURIComponent(name)}`;
        const r = await tb.get<any>(path);
        return ok(JSON.stringify(r, null, 2));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "get_capabilities",
    {
      title: "가능한 동작 조회",
      description: "서브시스템 manifest의 제어/텔레메트리. '뭘 할 수 있어?'.",
      inputSchema: {},
    },
    async () => {
      try {
        const subs = await tb.get<any[]>("/api/subsystems");
        if (!subs?.length) return ok("등록된 서브시스템 manifest가 없습니다.");
        const out: string[] = [];
        for (const s of subs) {
          const sub = s.subsystem ?? s;
          out.push(`■ ${sub.label ?? sub.id}`);
          for (const c of sub.controls ?? [])
            out.push(`  · 제어: ${c.label ?? c.id} (${c.kind} ${c.name})`);
          for (const t of sub.telemetry ?? [])
            out.push(`  · 측정: ${t.label ?? t.topic ?? t.hardware_id ?? "?"}`);
        }
        return ok(out.join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "list_profiles",
    {
      title: "프로파일 목록",
      description: "런치 묶음(프로파일)과 기동 상태. profile_up/down 대상 확인.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await tb.get<any[]>("/api/profiles");
        if (!r?.length) return ok("프로파일이 없습니다.");
        return ok(r.map((p: any) => `- ${p.id} (${p.label ?? ""}): ${p.up ? "기동됨" : "정지"}`).join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "list_processes",
    {
      title: "프로세스 목록",
      description: "테스트벤치가 관리하는 프로세스 레코드.",
      inputSchema: {},
    },
    async () => {
      try {
        const r = await tb.get<any[]>("/api/processes");
        return ok(r?.length ? JSON.stringify(r, null, 2) : "관리 중 프로세스 없음.");
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "list_running_launches",
    {
      title: "실행 중 런치",
      description: "실제 실행 중인 ros2 launch 프로세스(외부 포함). machine=server|controller.",
      inputSchema: { machine: z.enum(["server", "controller"]).default("server") },
    },
    async ({ machine }) => {
      try {
        const r = await tb.get<any[]>(`/api/processes/running?machine=${machine}`, 15000);
        if (!r?.length) return ok(`실행 중 런치 없음 (${machine}).`);
        return ok(r.map((x: any) => `- [${x.pid}] ${x.package} / ${x.file}`).join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "list_launches",
    {
      title: "런치 파일 목록",
      description: "설치된 실행 가능한 launch 파일(실행 없이 스캔). machine=server|controller.",
      inputSchema: {
        machine: z.enum(["server", "controller"]).default("server"),
        filter: z.string().optional(),
      },
    },
    async ({ machine, filter }) => {
      try {
        const files = await tb.get<Array<{ package: string; file: string }>>(
          `/api/launch/files?machine=${machine}`,
          15000,
        );
        let rows = files.map((f) => `${f.package} / ${f.file}`);
        if (filter) rows = rows.filter((r) => r.includes(filter));
        return ok(`런치 ${rows.length}개 (${machine})${filter ? ` 필터 '${filter}'` : ""}:\n` + rows.slice(0, 60).join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );
}
