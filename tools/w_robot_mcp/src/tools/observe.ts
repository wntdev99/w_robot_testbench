/** 관측 도구 (읽기 전용) — 상태/진단/모터. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { tb } from "../client.js";
import { latch } from "../latch.js";
import { ok, humanizeError } from "../util.js";

const LEVEL: Record<number, string> = { 0: "정상", 1: "경고", 2: "에러", 3: "미상" };

export function registerObserve(server: McpServer) {
  server.registerTool(
    "health",
    { title: "연결 확인", description: "서버 연결 확인.", inputSchema: {} },
    async () => {
      try {
        const h = await tb.get<{ version: string }>("/api/health");
        return ok(`연결 정상 ✅ (서버 ${tb.base}, 버전 ${h.version})`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "get_system_status",
    {
      title: "시스템 상태",
      description: "zenoh·컨트롤러(201)·CPU/온도 등 한눈 상태. '상태 보여줘'.",
      inputSchema: {},
    },
    async () => {
      try {
        const s = await tb.get<any>("/api/system/status");
        const zenoh = s.zenoh?.running ? "정상" : "꺼짐/미확인";
        const ctrl = s.controller?.reachable
          ? `연결됨${s.controller?.ssh_ok ? "" : "(SSH 미설정 ⚠)"}`
          : "연결 안 됨";
        const topo = s.controller?.topology === "with_controller" ? "함께" : "단독";
        return ok(
          [
            `zenoh: ${zenoh}`,
            `컨트롤러(201): ${ctrl} (${topo})`,
            `CPU: ${s.stats?.cpu_percent}% · 컨트롤러 지연: ${s.stats?.latency?.controller_ms}ms`,
            latch.engaged ? "⛔ 정지 래치 ENGAGED — reset_estop 필요" : "정지 래치: 해제됨",
          ].join("\n"),
        );
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "get_diagnostics",
    {
      title: "진단 요약",
      description: "/diagnostics 전 항목의 상태레벨(정상/경고/에러). 문제 항목을 빠르게 본다.",
      inputSchema: {},
    },
    async () => {
      try {
        const d = await tb.get<Record<string, any>>("/api/diagnostics");
        const entries = Object.values(d);
        const bad = entries.filter((v: any) => (v?._level ?? 0) !== 0);
        const lines = [
          `진단 ${entries.length}개 — ${bad.length ? `⚠ 비정상 ${bad.length}개` : "전부 정상 ✅"}`,
        ];
        for (const v of bad as any[])
          lines.push(`  ⚠ ${v._name}: ${LEVEL[v._level] ?? v._level}`);
        if (!bad.length)
          lines.push(
            "  (상세 수치는 모터가 에너자이즈/구동 중일 때 항목에 나타납니다.)",
          );
        return ok(lines.join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "get_motor_status",
    {
      title: "모터 상태",
      description: "모터/구동 관련 진단 항목의 상태와 보고된 수치. 모터 비에너자이즈면 수치 없이 레벨만.",
      inputSchema: {},
    },
    async () => {
      try {
        const d = await tb.get<Record<string, any>>("/api/diagnostics");
        const kw = ["motor", "vesc", "moteus", "zltech", "swerve", "wheel", "can"];
        const motors = Object.entries(d).filter(([k]) =>
          kw.some((x) => k.toLowerCase().includes(x)),
        );
        if (!motors.length) return ok("모터 관련 진단 항목이 없습니다.");
        const lines: string[] = [`모터 관련 ${motors.length}개:`];
        for (const [k, v] of motors as [string, any][]) {
          const vals = Object.entries(v)
            .filter(([key]) => !key.startsWith("_"))
            .map(([key, val]) => `${key}=${val}`);
          lines.push(
            `- ${k}: ${LEVEL[v._level] ?? v._level}${vals.length ? " | " + vals.join(", ") : ""}`,
          );
        }
        lines.push("※ 전류/온도/토크 상세는 모터 구동 중 표시. 실시간 effort는 watch('/joint_states').");
        return ok(lines.join("\n"));
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );
}
