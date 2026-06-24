/**
 * M4 테스트 런 엔진 — 데이터 레이어 (설계 §9).
 * 역할 분담: 초안/리뷰/오케스트레이션은 Claude(LLM)가, 이 MCP는
 *  ① 테스트 계획 저장/조회 ② 실행 기록(관측·측정) ③ 리포트(MD/JSON/CSV) 생성.
 * 실제 스텝(주행·USB포트·소생측정 등)은 Claude가 기존 원자 도구를 순서대로 호출하며
 * 그때그때 record_observation/record_measurement 로 결과를 남긴다.
 * 저장 위치: TEST_OUTPUT_DIR(기본 ~/w_robot_tests).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { promises as fs } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ok, osOpen } from "../util.js";

const TEST_DIR = process.env.TEST_OUTPUT_DIR || join(homedir(), "w_robot_tests");
const PLANS = join(TEST_DIR, "plans");
const RUNS = join(TEST_DIR, "runs");
const safe = (s: string) => s.replace(/[^\w.\-가-힣]/g, "_");
const nowIso = () => new Date().toISOString();

async function ensure(dir: string) {
  await fs.mkdir(dir, { recursive: true });
}
async function appendJsonl(file: string, obj: unknown) {
  await fs.appendFile(file, JSON.stringify(obj) + "\n", "utf-8");
}
async function readJsonl(file: string): Promise<any[]> {
  try {
    const txt = await fs.readFile(file, "utf-8");
    return txt.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

export function registerTests(server: McpServer) {
  // ── 리뷰 체크리스트(설계 §9.3) — Claude가 일관되게 적용하도록 ──
  server.registerTool(
    "review_checklist",
    {
      title: "테스트 설계 리뷰 기준",
      description: "테스트 계획을 비평할 때 적용할 점검 축(선행조건·주의·우려·안전·측정·합불·재현·인터페이스). review 전에 호출.",
      inputSchema: {},
    },
    async () =>
      ok(
        [
          "테스트 계획 리뷰 8축:",
          "1. 선행 테스트/조건 — 먼저 통과해야 할 것(예: 구동 정상→내구성, 로드셀 영점, 무하중 대조군). 미충족 시 실행 차단 권고.",
          "2. 주의점 — 사람·장비 안전, 장치 점유 충돌, 모터 과열, 손 끼임, 카메라 ON 시 인터넷 단절(시간차/자동복구).",
          "3. 우려지점 — 정성적 '파손' 재현불가, 힘 방향/접촉점 미정, 가속도/진입각 미규정 등 신뢰성 흔드는 요소.",
          "4. 안전 훅 — damage_risk 스텝에 E-stop·정지버튼·격리. 모터 인가 전 confirm·속도.",
          "5. 측정 충분성 — 판정 지표가 정량인가(effort_Nm·로드셀kg·스위치상태·소생시간·끊김수). 육안만이면 사진+체크리스트 표준화.",
          "6. 합·불 기준 — 스텝마다 명시적 pass/fail.",
          "7. 재현성 — 속도/하중/힘/반복수/정착시간 수치 고정, 환경 정의.",
          "8. 인터페이스 가용성 — 필요한 토픽/서비스 실재 확인(미실측이면 라이브확인 TODO).",
          "출력: 지적→근거→보완→(수정 시) 갱신 plan.",
        ].join("\n"),
      ),
  );

  server.registerTool(
    "test_sop",
    {
      title: "테스트 표준 절차(노션 기반)",
      description: "노션 페이지를 받아 시작하는 표준 테스트 절차. '테스트 어떻게 시작해?'·테스트 시작 직전에 호출.",
      inputSchema: {},
    },
    async () =>
      ok(
        [
          "테스트 표준 절차 (노션 기반):",
          "1. 사용자가 노션 페이지 URL을 준다 → notion-fetch로 읽는다.",
          "2. 페이지에서 추출: 실험 방법(스텝) · 정량 목표(합불 기준) · 기대 vs 실제 표(채울 칸).",
          "3. review_checklist 적용 → 선행조건·주의·측정충분성 점검 후 사용자와 합의.",
          "4. save_test_plan(notion_url 포함) → start_test_run. 화면 필요시 compose_view.",
          "5. w_robot 원자 도구로 스텝 실행 — 로봇 동작은 매번 사용자 승인. 측정/관측은 record_*로 즉시 기록.",
          "6. finish_test_run → 리포트(MD/JSON/CSV).",
          "7. 결과를 노션에 되돌려쓰기(승인 후): 실제결과 칸 + 상태 + 요약/리포트 댓글.",
          "주의: 카메라 RGBD 스트리밍은 인터넷 단절 유발 → 시간차/자동복구(camera_on_temporarily) 고려. 허브/모니터/포트제어는 소량 데이터라 무방.",
        ].join("\n"),
      ),
  );

  server.registerTool(
    "test_plan_template",
    {
      title: "테스트 계획 템플릿",
      description: "save_test_plan에 넣을 계획 구조(스텝 종류: robot/manual/measurement)와 예시.",
      inputSchema: {},
    },
    async () =>
      ok(
        JSON.stringify(
          {
            name: "옆문내구성",
            description: "옆문 90도 개폐 + 모터/스위치 확인",
            view_sources: ["1층 옆문 제어", "모터 전류 확인"],
            pass_fail: "파손 없음 + door effort ≤ 기준 + 잠김/스위치 정상",
            steps: [
              { kind: "manual", text: "골프백 10kg 적재", observe: "적재 완료(Y/N)" },
              { kind: "measurement", capture: "/joint_states(door effort)", how: "watch 3초" },
              { kind: "robot", action: "door open", cmd: "/door_s1_controller/command=open" },
              { kind: "manual", text: "잠김·마이크로스위치 정상 확인", observe: "lock=engaged?" },
            ],
          },
          null,
          2,
        ),
      ),
  );

  // ── 계획 저장/조회 ──
  server.registerTool(
    "save_test_plan",
    {
      title: "테스트 계획 저장",
      description: "테스트 계획(JSON)을 저장. steps는 robot/manual/measurement 스텝 배열.",
      inputSchema: {
        name: z.string(),
        description: z.string().default(""),
        steps: z.array(z.record(z.any())).default([]),
        view_sources: z.array(z.string()).default([]).describe("이 테스트에 합칠 스냅샷 이름들"),
        pass_fail: z.string().default(""),
        notion_url: z.string().default("").describe("이 테스트의 노션 원본 페이지 URL(실험방법·기대표 출처)"),
      },
    },
    async ({ name, description, steps, view_sources, pass_fail, notion_url }) => {
      await ensure(PLANS);
      const plan = { name, description, steps, view_sources, pass_fail, notion_url, saved: nowIso() };
      await fs.writeFile(join(PLANS, `${safe(name)}.json`), JSON.stringify(plan, null, 2), "utf-8");
      return ok(`저장됨: ${name} (스텝 ${steps.length}개) → ${join(PLANS, safe(name) + ".json")}`);
    },
  );

  server.registerTool(
    "list_test_plans",
    { title: "테스트 계획 목록", description: "저장된 테스트 계획 목록.", inputSchema: {} },
    async () => {
      await ensure(PLANS);
      const files = (await fs.readdir(PLANS)).filter((f) => f.endsWith(".json"));
      if (!files.length) return ok("저장된 계획이 없습니다.");
      return ok("테스트 계획:\n" + files.map((f) => `- ${f.replace(/\.json$/, "")}`).join("\n"));
    },
  );

  server.registerTool(
    "get_test_plan",
    {
      title: "테스트 계획 조회",
      description: "저장된 테스트 계획 내용 조회.",
      inputSchema: { name: z.string() },
    },
    async ({ name }) => {
      try {
        return ok(await fs.readFile(join(PLANS, `${safe(name)}.json`), "utf-8"));
      } catch {
        return ok(`계획 '${name}'을 찾을 수 없습니다.`);
      }
    },
  );

  // ── 실행 기록 ──
  server.registerTool(
    "start_test_run",
    {
      title: "테스트 실행 시작",
      description: "테스트 런을 시작하고 run_id를 발급. 이후 record_observation/record_measurement로 기록, finish_test_run으로 리포트.",
      inputSchema: {
        plan_name: z.string().default("").describe("저장된 계획명(없으면 즉석 런)"),
        title: z.string().default(""),
      },
    },
    async ({ plan_name, title }) => {
      const runId = `${safe(plan_name || title || "run")}_${nowIso().replace(/[:.]/g, "-")}`;
      const dir = join(RUNS, runId);
      await ensure(dir);
      let plan: any = null;
      if (plan_name) {
        try {
          plan = JSON.parse(await fs.readFile(join(PLANS, `${safe(plan_name)}.json`), "utf-8"));
        } catch {
          /* 즉석 런 */
        }
      }
      await fs.writeFile(
        join(dir, "meta.json"),
        JSON.stringify({ runId, plan_name, title, plan, started: nowIso() }, null, 2),
        "utf-8",
      );
      return ok(
        `▶ 테스트 런 시작: ${runId}\n` +
          (plan?.notion_url ? `📄 노션 원본: ${plan.notion_url} — 먼저 notion-fetch로 실험방법·기대표를 읽으세요.\n` : "") +
          (plan?.view_sources?.length ? `화면 조합 추천: compose_view("${plan_name}", ${JSON.stringify(plan.view_sources)})\n` : "") +
          `기록: record_observation/record_measurement(run_id="${runId}", ...). 종료: finish_test_run → 결과를 노션 실제결과 칸에 기입.`,
      );
    },
  );

  server.registerTool(
    "record_observation",
    {
      title: "관측 기록",
      description: "사람 관측을 기록(파손 Y/N, 잠김 상태, 사진 경로 등).",
      inputSchema: {
        run_id: z.string(),
        step: z.string().describe("스텝 식별(번호/이름)"),
        note: z.string(),
        value: z.string().default(""),
      },
    },
    async ({ run_id, step, note, value }) => {
      const dir = join(RUNS, safe(run_id));
      await ensure(dir);
      await appendJsonl(join(dir, "records.jsonl"), { ts: nowIso(), kind: "observation", step, note, value });
      return ok(`관측 기록됨 [${step}] ${note}${value ? ` = ${value}` : ""}`);
    },
  );

  server.registerTool(
    "record_measurement",
    {
      title: "측정 기록",
      description: "측정값을 기록(소생시간/끊김수/effort 통계/로드셀kg 등). data는 임의 dict.",
      inputSchema: {
        run_id: z.string(),
        step: z.string(),
        label: z.string(),
        data: z.record(z.any()).default({}),
      },
    },
    async ({ run_id, step, label, data }) => {
      const dir = join(RUNS, safe(run_id));
      await ensure(dir);
      await appendJsonl(join(dir, "records.jsonl"), { ts: nowIso(), kind: "measurement", step, label, data });
      return ok(`측정 기록됨 [${step}] ${label}: ${JSON.stringify(data)}`);
    },
  );

  server.registerTool(
    "finish_test_run",
    {
      title: "테스트 종료·리포트",
      description: "테스트 런을 마무리하고 리포트(Markdown+JSON+CSV)를 생성. 합불·요약 포함.",
      inputSchema: {
        run_id: z.string(),
        verdict: z.string().default("").describe("합/불/조건부 등"),
        summary: z.string().default(""),
        open: z.boolean().default(false).describe("리포트를 브라우저/기본앱으로 열기"),
      },
    },
    async ({ run_id, verdict, summary, open }) => {
      const dir = join(RUNS, safe(run_id));
      try {
        const meta = JSON.parse(await fs.readFile(join(dir, "meta.json"), "utf-8").catch(() => "{}"));
        const records = await readJsonl(join(dir, "records.jsonl"));
        const obs = records.filter((r) => r.kind === "observation");
        const meas = records.filter((r) => r.kind === "measurement");
        // JSON
        const data = { ...meta, finished: nowIso(), verdict, summary, records };
        await fs.writeFile(join(dir, "data.json"), JSON.stringify(data, null, 2), "utf-8");
        // CSV (측정값 평탄화)
        const rows = [["ts", "step", "label", "key", "value"]];
        for (const m of meas)
          for (const [k, v] of Object.entries(m.data ?? {}))
            rows.push([m.ts, m.step, m.label, k, typeof v === "object" ? JSON.stringify(v) : String(v)]);
        await fs.writeFile(
          join(dir, "measurements.csv"),
          rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n"),
          "utf-8",
        );
        // Markdown
        const md = [
          `# 테스트 리포트 — ${meta.title || meta.plan_name || run_id}`,
          `- run_id: ${run_id}`,
          `- 시작: ${meta.started} / 종료: ${data.finished}`,
          meta.plan?.notion_url ? `- 노션 원본: ${meta.plan.notion_url}` : "",
          `- **판정: ${verdict || "(미기재)"}**`,
          summary ? `\n${summary}\n` : "",
          `## 측정 (${meas.length})`,
          ...meas.map((m) => `- [${m.step}] **${m.label}**: ${JSON.stringify(m.data)} _(${m.ts})_`),
          `\n## 관측 (${obs.length})`,
          ...obs.map((o) => `- [${o.step}] ${o.note}${o.value ? ` = **${o.value}**` : ""} _(${o.ts})_`),
        ].join("\n");
        const mdPath = join(dir, "report.md");
        await fs.writeFile(mdPath, md, "utf-8");
        if (open) osOpen(mdPath);
        return ok(
          `✅ 리포트 생성 (${dir}):\n- report.md\n- data.json\n- measurements.csv\n측정 ${meas.length} · 관측 ${obs.length} · 판정 ${verdict || "미기재"}`,
        );
      } catch (e) {
        return ok(`리포트 생성 실패: ${e instanceof Error ? e.message : String(e)}`);
      }
    },
  );

  server.registerTool(
    "open_test_report",
    {
      title: "리포트 열기",
      description: "생성된 테스트 리포트(report.md)를 기본 앱으로 연다.",
      inputSchema: { run_id: z.string() },
    },
    async ({ run_id }) => {
      osOpen(join(RUNS, safe(run_id), "report.md"));
      return ok(`리포트를 열었습니다: ${join(RUNS, safe(run_id), "report.md")}`);
    },
  );
}
