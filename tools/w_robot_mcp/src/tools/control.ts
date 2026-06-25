/** 제어·안전 도구 (M3) — 모든 모션은 승인 필수, 정지 최우선. */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tb } from "../client.js";
import { latch } from "../latch.js";
import {
  ALLOW_DESTRUCTIVE,
  HEARTBEAT_MS,
  MAX_BACKGROUND_S,
  MAX_DURATION_S,
  SAFETY_CHECK_EVERY,
  SOFT_CAP_ANGULAR,
  SOFT_CAP_LINEAR,
} from "../config.js";
import { driver } from "../driver.js";
import { planGate } from "../plangate.js";
import {
  humanizeError,
  ok,
  publishCmdVel,
  sleep,
  swerveActive,
  twist,
  yawToQuat,
  zeroTwist,
} from "../util.js";

const latchBlock = "⛔ 정지 래치가 걸려 있어 실행할 수 없습니다. 'reset_estop' 후 다시 시도하세요.";

/** 주행 동작 설명 텍스트 생성. */
function moveDesc(vx: number, vy: number, omega: number): string {
  const p: string[] = [];
  if (vx) p.push(`${vx > 0 ? "전진" : "후진"} ${Math.abs(vx)} m/s`);
  if (vy) p.push(`${vy > 0 ? "좌" : "우"} 횡이동 ${Math.abs(vy)} m/s`);
  if (omega) p.push(`${omega > 0 ? "좌(반시계)" : "우(시계)"} 회전 ${Math.abs(omega)} rad/s`);
  return p.length ? p.join(", ") : "정지(0)";
}
const tooFast = (vx: number, vy: number, omega: number) =>
  Math.abs(vx) >= SOFT_CAP_LINEAR || Math.abs(vy) >= SOFT_CAP_LINEAR || Math.abs(omega) >= SOFT_CAP_ANGULAR;

export function registerControl(server: McpServer) {
  // ── 정지/안전 (최우선) ──
  server.registerTool(
    "emergency_stop",
    {
      title: "비상정지",
      description: "즉시 정지: 속도 0 + 컨트롤러 비활성 + 주행 취소. 항상 실행되며 정지 래치를 건다.",
      inputSchema: {},
    },
    async () => {
      await driver.stop("emergency_stop"); // 백그라운드 연속주행 먼저 중단
      try {
        const r = await tb.post<any>("/api/emergency/stop");
        latch.engage("emergency_stop");
        return ok(
          `⛔ 비상정지 실행됨 (속도0=${r?.cmd_vel_zeroed}, 비활성=${JSON.stringify(r?.deactivated ?? [])}).\n정지 래치 ENGAGED — 'reset_estop' 후 컨트롤러 재활성 필요.`,
        );
      } catch (e) {
        latch.engage("emergency_stop(backend error)");
        return ok(`⚠ 비상정지 중 오류: ${humanizeError(e)}\n안전을 위해 래치는 걸었습니다.`);
      }
    },
  );

  server.registerTool(
    "stop",
    {
      title: "정지(속도 0)",
      description: "부드러운 정지 — 백그라운드 연속주행 중단 + cmd_vel 0 발행(컨트롤러 유지, 래치 안 검).",
      inputSchema: {},
    },
    async () => {
      const wasDriving = await driver.stop("사용자 stop"); // 백그라운드 주행 중단
      try {
        for (let i = 0; i < 3; i++) {
          await publishCmdVel(zeroTwist());
          await sleep(50);
        }
        return ok(`정지(속도 0) 발행 완료.${wasDriving ? " 연속 주행을 중단했습니다." : ""}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "cancel_navigation",
    {
      title: "주행 취소",
      description: "진행 중인 네비게이션(목표주행)을 취소.",
      inputSchema: {},
    },
    async () => {
      try {
        await tb.post("/api/nav/cancel");
        return ok("네비게이션 취소 요청 완료.");
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "estop_status",
    { title: "정지 래치 상태", description: "현재 정지 래치 상태 조회.", inputSchema: {} },
    async () => {
      if (!latch.engaged) return ok("정지 래치: 해제됨 (움직일 수 있음).");
      const secs = latch.sinceMs ? Math.round((Date.now() - latch.sinceMs) / 1000) : 0;
      return ok(`⛔ 정지 래치 ENGAGED (${secs}초 전, 사유: ${latch.reason}). 'reset_estop'으로 해제.`);
    },
  );

  server.registerTool(
    "reset_estop",
    {
      title: "정지 해제",
      description: "정지 래치를 해제(명시적). 해제 후 컨트롤러가 비활성이면 재활성 필요.",
      inputSchema: { confirm: z.boolean().default(false) },
    },
    async ({ confirm }) => {
      if (!latch.engaged) return ok("이미 해제 상태입니다.");
      if (!confirm) return ok("정지 래치 해제는 confirm=true. 주변 안전을 먼저 확인하세요.");
      latch.reset();
      return ok("정지 래치 해제됨. 움직이려면 컨트롤러가 active인지 확인하세요(list_controllers).");
    },
  );

  // ── 짧은 점검 주행(블로킹, 승인 필수) ──
  server.registerTool(
    "drive",
    {
      title: "짧은 주행(승인 필수)",
      description:
        "정해진 시간만 잠깐 움직이는 점검용. confirm 없으면 계획만 반환(안 움직임). 길게/연속은 start_drive 사용. 멈추려면 stop/emergency_stop.",
      inputSchema: {
        vx: z.number().default(0).describe("전후 m/s (+앞)"),
        vy: z.number().default(0).describe("좌우(게걸음) m/s (+좌)"),
        omega: z.number().default(0).describe("회전 rad/s (+반시계)"),
        duration_s: z.number().default(2).describe(`초 (최대 ${MAX_DURATION_S})`),
        confirm: z.boolean().default(false),
        token: z.string().default("").describe("계획 단계에서 받은 승인 토큰(실행 시 필수)"),
      },
    },
    async ({ vx, vy, omega, duration_s, confirm, token }) => {
      if (latch.engaged) return ok(latchBlock);
      if (driver.active) return ok("이미 연속 주행 중입니다(start_drive). 먼저 'stop' 후 다시.");
      const dur = Math.min(Math.max(duration_s, 0), MAX_DURATION_S);
      const key = `drive|${vx}|${vy}|${omega}|${dur}`;
      if (!confirm) {
        const tk = planGate.issue(key);
        return ok(
          [
            "🚗 실행 예정 동작:",
            `  ${moveDesc(vx, vy, omega)} — ${dur}초`,
            "  (10Hz 하트비트 → 종료 시 자동 정지, 컨트롤러 0.5s 타임아웃)",
            tooFast(vx, vy, omega) ? "  ⚠ 권장 속도(0.3 m/s / 0.5 rad/s) 초과 — 안전거리·정지버튼 재확인" : "",
            "⚠ 정지 버튼(stop.html)이 열려 있는지 확인하세요.",
            `**사용자 승인을 받은 뒤** confirm=true, token="${tk}" 로 실행 (이 값 그대로). 파라미터 바꾸면 토큰 무효 → 다시 계획.`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      const gateErr = planGate.check(key, token);
      if (gateErr) return ok(`⛔ 실행 거부(${gateErr}). confirm 없이 다시 호출해 계획을 띄우고 사용자 승인을 받으세요.`);
      // 사전 점검: 컨트롤러가 active 가 아니면 주행 불가(발행해도 무효 + 혼란 방지)
      if (!(await swerveActive()))
        return ok(
          "swerve_controller가 active가 아니라 주행할 수 없습니다. 먼저 활성화하세요(switch_controller activate=['swerve_controller']).",
        );
      try {
        const end = Date.now() + dur * 1000;
        let n = 0;
        let aborted: string | null = null;
        while (Date.now() < end) {
          if (latch.engaged) {
            aborted = "정지 래치";
            break;
          }
          // 0.5s마다 컨트롤러가 여전히 active인지 확인 — GUI 정지 등으로 꺼지면 즉시 발행 중단(좀비 발행·재활성 덜컥 방지)
          if (n % SAFETY_CHECK_EVERY === 0 && n > 0 && !(await swerveActive())) {
            aborted = "컨트롤러 비활성 감지(정지됨)";
            break;
          }
          await publishCmdVel(twist(vx, vy, omega));
          n++;
          await sleep(HEARTBEAT_MS);
        }
        await publishCmdVel(zeroTwist());
        return ok(
          aborted
            ? `⛔ 주행 중단(${aborted}). 발행을 멈췄습니다. 재주행은 안전 확인 후.`
            : `주행 완료: ${n}회 발행, ${dur}초. 자동 정지(0) 발행함.`,
        );
      } catch (e) {
        await publishCmdVel(zeroTwist()).catch(() => {});
        return ok(`주행 중 오류 → 정지 시도함: ${humanizeError(e)}`);
      }
    },
  );

  // ── 왕복 반복 주행 (연속, 한 호출로 자율 실행, 승인 필수) ──
  server.registerTool(
    "drive_cycles",
    {
      title: "왕복 반복 주행(연속, 승인 필수)",
      description:
        "한 방향으로 segment_s초 → 반대로 segment_s초를 1사이클로, cycles회 끊김 없이 연속 반복(왕복). 한 번의 호출로 MCP가 자율 실행해 사이클 사이 텀이 없음. confirm 없으면 계획만.",
      inputSchema: {
        vx: z.number().default(0.1).describe("첫 구간 전후 속도 m/s(부호=첫 방향). 반대구간은 자동 반전"),
        vy: z.number().default(0).describe("횡이동 m/s(왕복 게걸음용)"),
        omega: z.number().default(0).describe("회전 rad/s(왕복 회전용)"),
        segment_s: z.number().default(5).describe("각 방향 지속 초"),
        cycles: z.number().default(5).describe("왕복 횟수(최대 50)"),
        settle_s: z.number().default(0).describe("방향 전환 사이 정지 초(0=완전 연속)"),
        confirm: z.boolean().default(false),
        token: z.string().default("").describe("계획 단계에서 받은 승인 토큰(실행 시 필수)"),
      },
    },
    async ({ vx, vy, omega, segment_s, cycles, settle_s, confirm, token }) => {
      if (latch.engaged) return ok(latchBlock);
      const cyc = Math.min(Math.max(Math.round(cycles), 1), 50);
      const seg = Math.min(Math.max(segment_s, 0.5), 30);
      const settle = Math.min(Math.max(settle_s, 0), 5);
      if (vx === 0 && vy === 0 && omega === 0)
        return ok("속도가 모두 0입니다. 왕복할 방향을 지정하세요.");
      const fast = tooFast(vx, vy, omega);
      const key = `drive_cycles|${vx}|${vy}|${omega}|${seg}|${cyc}|${settle}`;
      if (!confirm) {
        const totalS = cyc * 2 * seg + (settle > 0 ? cyc * 2 * settle : 0);
        const tk = planGate.issue(key);
        return ok(
          [
            "🔁 왕복 반복 예정(연속):",
            `  A: ${moveDesc(vx, vy, omega)} ${seg}초 → B: 반대방향 ${seg}초 = 1사이클`,
            `  × ${cyc}회, 방향전환 정지 ${settle}초${settle === 0 ? "(완전 연속)" : ""}`,
            `  총 약 ${Math.round(totalS)}초, 한 호출로 자율 실행(사이 텀 없음)`,
            fast ? "  ⚠ 권장 속도 초과 — 안전거리·정지버튼 재확인" : "",
            "⚠ 앞·뒤 공간 + 정지 버튼(stop.html) 확인. 멈추려면 stop/emergency_stop.",
            `**사용자 승인 후** confirm=true, token="${tk}" 로 실행. 파라미터 바꾸면 토큰 무효 → 다시 계획.`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      const gateErr = planGate.check(key, token);
      if (gateErr) return ok(`⛔ 실행 거부(${gateErr}). confirm 없이 다시 호출해 계획을 띄우고 사용자 승인을 받으세요.`);
      if (!(await swerveActive()))
        return ok("swerve_controller가 active가 아닙니다. 먼저 활성화하세요.");
      let beats = 0;
      let done = 0;
      let aborted: string | null = null;
      const runLeg = async (lvx: number, lvy: number, lw: number): Promise<boolean> => {
        const end = Date.now() + seg * 1000;
        while (Date.now() < end) {
          if (latch.engaged) {
            aborted = "정지 래치";
            return false;
          }
          if (beats > 0 && beats % SAFETY_CHECK_EVERY === 0 && !(await swerveActive())) {
            aborted = "컨트롤러 비활성 감지";
            return false;
          }
          await publishCmdVel(twist(lvx, lvy, lw));
          beats++;
          await sleep(HEARTBEAT_MS);
        }
        return true;
      };
      try {
        for (let c = 0; c < cyc; c++) {
          if (!(await runLeg(vx, vy, omega))) break;
          if (settle > 0) {
            await publishCmdVel(zeroTwist());
            await sleep(settle * 1000);
          }
          if (!(await runLeg(-vx, -vy, -omega))) break;
          done = c + 1;
          if (settle > 0 && c < cyc - 1) {
            await publishCmdVel(zeroTwist());
            await sleep(settle * 1000);
          }
        }
        await publishCmdVel(zeroTwist());
        return ok(
          aborted
            ? `⛔ 왕복 ${done}/${cyc}회에서 중단(${aborted}). 정지함.`
            : `🔁 왕복 ${done}/${cyc}회 연속 완료. 자동 정지(0) 발행함.`,
        );
      } catch (e) {
        await publishCmdVel(zeroTwist()).catch(() => {});
        return ok(`왕복 중 오류 → 정지 시도함: ${humanizeError(e)}`);
      }
    },
  );

  // ── 연속 주행(백그라운드, 승인 필수) ──
  server.registerTool(
    "start_drive",
    {
      title: "연속 주행 시작(승인 필수)",
      description:
        "백그라운드로 계속 주행하고 즉시 반환 → 주행 중 watch로 모니터링 가능. confirm 없으면 계획만. 멈추려면 stop/emergency_stop. " +
        `${MAX_BACKGROUND_S}s 후 자동정지(백스톱).`,
      inputSchema: {
        vx: z.number().default(0).describe("전후 m/s (+앞)"),
        vy: z.number().default(0).describe("좌우(게걸음) m/s (+좌)"),
        omega: z.number().default(0).describe("회전 rad/s (+반시계)"),
        confirm: z.boolean().default(false),
        token: z.string().default("").describe("계획 단계에서 받은 승인 토큰(실행 시 필수)"),
      },
    },
    async ({ vx, vy, omega, confirm, token }) => {
      if (latch.engaged) return ok(latchBlock);
      if (vx === 0 && vy === 0 && omega === 0)
        return ok("속도가 모두 0입니다. 움직일 방향을 지정하세요(또는 stop).");
      const key = `start_drive|${vx}|${vy}|${omega}`;
      if (!confirm) {
        const tk = planGate.issue(key);
        return ok(
          [
            "🚗 연속 주행 예정:",
            `  ${moveDesc(vx, vy, omega)} — 멈출 때까지 계속(최대 ${MAX_BACKGROUND_S}s 백스톱)`,
            "  (백그라운드 10Hz 발행. 0.5s마다 컨트롤러 확인, 꺼지면 자동중단)",
            tooFast(vx, vy, omega) ? "  ⚠ 권장 속도 초과 — 안전거리·정지버튼 재확인" : "",
            "⚠ 정지 버튼(stop.html)이 열려 있는지 확인하세요. 멈추려면 'stop'.",
            `**사용자 승인 후** confirm=true, token="${tk}" 로 시작. 파라미터 바꾸면 토큰 무효 → 다시 계획.`,
          ]
            .filter(Boolean)
            .join("\n"),
        );
      }
      const gateErr = planGate.check(key, token);
      if (gateErr) return ok(`⛔ 실행 거부(${gateErr}). confirm 없이 다시 호출해 계획을 띄우고 사용자 승인을 받으세요.`);
      if (!(await swerveActive()))
        return ok(
          "swerve_controller가 active가 아니라 주행할 수 없습니다. 먼저 활성화하세요(switch_controller activate=['swerve_controller']).",
        );
      driver.start(vx, vy, omega);
      return ok(
        `▶ 연속 주행 시작: ${moveDesc(vx, vy, omega)}. 'stop'으로 멈추세요. ` +
          `주행 중 watch('/joint_states')로 모니터링 가능. ${MAX_BACKGROUND_S}s 후 자동정지.`,
      );
    },
  );

  server.registerTool(
    "drive_status",
    {
      title: "주행 상태",
      description: "백그라운드 연속 주행 진행 상태 조회.",
      inputSchema: {},
    },
    async () => {
      const s = driver.status();
      return ok(
        s.active
          ? `▶ 연속 주행 중: ${moveDesc(s.vx, s.vy, s.omega)}, ${s.elapsed}s 경과. 멈추려면 'stop'.`
          : `정지 상태${s.lastStop ? ` (마지막 중단: ${s.lastStop})` : ""}.`,
      );
    },
  );

  // ── 컨트롤러 전환 (모터 인가 → confirm) ──
  server.registerTool(
    "switch_controller",
    {
      title: "컨트롤러 활성/비활성(승인 필수)",
      description: "컨트롤러를 활성/비활성. 활성화는 모터 인가 → confirm 필수.",
      inputSchema: {
        activate: z.array(z.string()).default([]),
        deactivate: z.array(z.string()).default([]),
        confirm: z.boolean().default(false),
      },
    },
    async ({ activate, deactivate, confirm }) => {
      if (activate.length && latch.engaged) return ok(latchBlock);
      if (!confirm)
        return ok(
          `🔌 예정: 활성=${JSON.stringify(activate)}, 비활성=${JSON.stringify(deactivate)}.\n활성화는 모터에 전원이 들어갑니다. 승인 시 confirm=true.`,
        );
      try {
        const r = await tb.post<any>("/api/controllers/switch", { activate, deactivate });
        return ok(`완료: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  // ── 목표 주행 (드라이브 → confirm) ──
  server.registerTool(
    "send_nav_goal",
    {
      title: "목표 지점 주행(승인 필수)",
      description: "맵 좌표 (x,y,yaw)로 자율주행 목표를 보낸다. 로봇이 움직임 → confirm 필수.",
      inputSchema: {
        x: z.number(),
        y: z.number(),
        yaw: z.number().default(0).describe("방향 rad"),
        frame_id: z.string().default("map"),
        confirm: z.boolean().default(false),
      },
    },
    async ({ x, y, yaw, frame_id, confirm }) => {
      if (latch.engaged) return ok(latchBlock);
      if (!confirm)
        return ok(
          `🧭 예정: (${x}, ${y}, yaw ${yaw}) [${frame_id}]로 자율주행.\n로봇이 스스로 이동합니다. 정지 버튼 확인 후 confirm=true.`,
        );
      try {
        const q = yawToQuat(yaw);
        const goal = {
          pose: {
            header: { frame_id },
            pose: { position: { x, y, z: 0 }, orientation: q },
          },
        };
        const r = await tb.post<any>("/api/action", {
          type: "nav2_msgs/action/NavigateToPose",
          name: "/navigate_to_pose",
          goal,
        });
        return ok(`목표 전송: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  // ── 런치/프로파일 (기동 → confirm) ──
  server.registerTool(
    "run_launch",
    {
      title: "런치 실행(승인 필수)",
      description:
        "설치된 launch 파일을 실행해 기능을 켠다. 이미 실행 중이면 중복 실행을 막는다(force로 강제). confirm 필수.",
      inputSchema: {
        package: z.string(),
        file: z.string(),
        machine: z.enum(["server", "controller"]).default("server"),
        args: z.string().default(""),
        confirm: z.boolean().default(false),
        force: z.boolean().default(false).describe("이미 실행 중이어도 강제 실행(중복)"),
      },
    },
    async ({ package: pkg, file, machine, args, confirm, force }) => {
      // 중복 실행 가드 — 같은 package/file 이 이미 떠 있으면 충돌 위험
      const running = await tb
        .get<Array<{ pid: number; package: string; file: string }>>(`/api/processes/running?machine=${machine}`, 15000)
        .catch(() => [] as any[]);
      const dup = running.find((r) => r.package === pkg && r.file === file);
      if (!confirm) {
        return ok(
          `▶ 예정: ${machine}에서 '${pkg} ${file} ${args}' 실행.` +
            (dup
              ? `\n⚠ 이미 실행 중입니다 (pid ${dup.pid}). 중복 실행은 노드/포트 충돌을 일으킬 수 있어요. 보통은 그대로 두면 됩니다. 정말 다시 켜려면 먼저 stop_launch 하거나 force=true.`
              : "") +
            "\n승인 시 confirm=true.",
        );
      }
      if (dup && !force)
        return ok(
          `⚠ '${pkg} ${file}'은 이미 실행 중(pid ${dup.pid})입니다 — 중복 실행 안 함(충돌 방지). 다시 켜려면 먼저 stop_launch 하거나 force=true로 호출하세요.`,
        );
      try {
        const r = await tb.post<any>("/api/launch/run", { machine, package: pkg, file, args }, 20000);
        return ok(`실행 요청: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "stop_launch",
    {
      title: "런치 종료",
      description: "실행 중인 런치/프로세스를 id로 종료.",
      inputSchema: { id: z.string(), confirm: z.boolean().default(false) },
    },
    async ({ id, confirm }) => {
      if (!confirm) return ok(`■ 예정: 프로세스 '${id}' 종료. 승인 시 confirm=true.`);
      try {
        const r = await tb.post<any>("/api/launch/stop", { id });
        return ok(`종료 요청: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  for (const dir of ["up", "down"] as const) {
    server.registerTool(
      `profile_${dir}`,
      {
        title: `프로파일 ${dir === "up" ? "기동" : "종료"}(승인 필수)`,
        description: `프로파일(런치 묶음)을 ${dir === "up" ? "기동" : "종료"}한다. 기동은 이미 떠 있으면 중복 방지(force). confirm 필수.`,
        inputSchema: {
          profile_id: z.string(),
          confirm: z.boolean().default(false),
          force: z.boolean().default(false).describe("이미 기동된 프로파일도 강제 재기동"),
        },
      },
      async ({ profile_id, confirm, force }) => {
        if (dir === "up" && latch.engaged) return ok(latchBlock);
        // 기동 중복 가드
        let alreadyUp = false;
        if (dir === "up") {
          const profs = await tb.get<Array<{ id: string; up: boolean }>>("/api/profiles").catch(() => [] as any[]);
          alreadyUp = !!profs.find((p) => p.id === profile_id)?.up;
        }
        if (!confirm)
          return ok(
            `${dir === "up" ? "▶" : "■"} 예정: 프로파일 '${profile_id}' ${dir}.` +
              (alreadyUp ? " ⚠ 이미 기동돼 있습니다 — 중복 기동은 충돌 위험(force=true로 강제)." : "") +
              " 승인 시 confirm=true.",
          );
        if (dir === "up" && alreadyUp && !force)
          return ok(`⚠ 프로파일 '${profile_id}'은 이미 기동돼 있습니다 — 중복 기동 안 함. 재기동하려면 force=true.`);
        try {
          const r = await tb.post<any>(`/api/profiles/${encodeURIComponent(profile_id)}/${dir}`, undefined, 30000);
          return ok(`${dir} 요청: ${JSON.stringify(r)}`);
        } catch (e) {
          return ok(humanizeError(e));
        }
      },
    );
  }

  // ── 파괴적(기본 비활성) ──
  if (ALLOW_DESTRUCTIVE) {
    server.registerTool(
      "kill_all_ros2",
      {
        title: "⚠ ros2 일괄 종료(관리자)",
        description: "기존 ros2 프로세스를 일괄 종료(파괴적). 관리자 전용.",
        inputSchema: {
          scope: z.array(z.string()).default(["server", "controller"]),
          confirm: z.boolean().default(false),
        },
      },
      async ({ scope, confirm }) => {
        if (!confirm) return ok(`🛑 파괴적: ${JSON.stringify(scope)}의 ros2를 모두 종료합니다. confirm=true 필요.`);
        try {
          const r = await tb.post<any>("/api/admin/kill", { scope }, 30000);
          return ok(`종료: ${JSON.stringify(r)}`);
        } catch (e) {
          return ok(humanizeError(e));
        }
      },
    );
  }

  // ── 프리플라이트 (설계 §11.1) ──
  server.registerTool(
    "preflight",
    {
      title: "사전 점검",
      description: "테스트/주행 전 준비 상태를 한눈에: 연결·컨트롤러·로드셀·정지 래치. 막힌 곳과 다음 행동을 알려줌.",
      inputSchema: {},
    },
    async () => {
      const lines: string[] = ["사전 점검:"];
      try {
        const s = await tb.get<any>("/api/system/status");
        lines.push(`- zenoh: ${s.zenoh?.running ? "✅" : "⚠ 꺼짐"}`);
        lines.push(
          `- 컨트롤러(201): ${s.controller?.reachable ? "✅ 연결" : "⚠ 연결 안 됨 → 로봇 기동 필요"}`,
        );
      } catch (e) {
        lines.push(`- 서버: ⚠ ${humanizeError(e)}`);
      }
      try {
        const cs = await tb.get<Array<{ name: string; state: string }>>("/api/controllers");
        const sw = cs.find((c) => c.name === "swerve_controller");
        lines.push(`- swerve_controller: ${sw?.state === "active" ? "✅ active" : `⚠ ${sw?.state ?? "없음"} → 주행 전 활성화 필요`}`);
      } catch {
        lines.push("- 컨트롤러: ⚠ 조회 실패");
      }
      lines.push(
        latch.engaged ? "- 정지 래치: ⛔ ENGAGED → reset_estop 필요" : "- 정지 래치: ✅ 해제",
      );
      lines.push("- ⚠ 주행 테스트 전 정지 버튼(stop.html)을 열어 두세요.");
      return ok(lines.join("\n"));
    },
  );
}
