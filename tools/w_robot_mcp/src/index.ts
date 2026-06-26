/**
 * w_robot_mcp — Claude용 로봇 테스트벤치 조작 MCP (stdio).
 *
 * 기존 testbench HTTP/WS API의 얇은 클라이언트 (백엔드 무수정).
 * 안전 원칙(설계 §4·§15): 모든 모션(drive/nav/활성화)은 confirm 필수,
 *   confirm 없으면 계획만 반환·미실행. 정지 래치 engaged 동안 모션 거부. 정지 최우선.
 * 설계: docs/mcp-design.md
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tb } from "./client.js";
import { osOpen } from "./util.js";
import { WsHub } from "./realtime.js";
import { registerObserve } from "./tools/observe.js";
import { registerDiscover } from "./tools/discover.js";
import { registerRealtime } from "./tools/realtime.js";
import { registerControl } from "./tools/control.js";
import { registerCamera } from "./tools/camera.js";
import { registerRecorder } from "./tools/recorder.js";
import { registerRos } from "./tools/ros.js";
import { registerNav } from "./tools/nav.js";
import { registerAdmin } from "./tools/admin.js";
import { registerView } from "./tools/view.js";
import { registerUsbHub } from "./tools/usbhub.js";
import { registerTests } from "./tools/tests.js";
import { registerLoadcell } from "./tools/loadcell.js";
import { registerLogs } from "./tools/logs.js";
import { logEvent, signalOnPush } from "./logstore.js";

const INSTRUCTIONS = [
  "당신은 하드웨어 엔지니어(비개발자)가 로봇을 테스트하도록 돕는다.",
  "전문용어 대신 테스트 목적 언어로 말한다.",
  "로봇을 움직이는 모든 동작은 실행 전 '어떻게 움직일지'를 설명하고 사용자의 명시적 승인을 받는다.",
  "모션 도구(drive/start_drive/drive_cycles)는 매번 예외 없이: (1) confirm 없이 호출해 계획+토큰을 받고, (2) 그 계획을 사용자에게 보여주고 턴을 끝내 명시적 승인을 기다린 뒤, (3) 승인되면 confirm=true와 받은 token으로 실행한다. 계획과 실행을 같은 턴에 몰아 하지 않는다. 속도·시간·횟수 등 무엇이든 바뀌면 토큰이 무효이니 반드시 계획부터 다시 한다(이전 승인 재사용 금지).",
  "모르면 추측하지 말고 발견 도구로 라이브 확인한다. 토픽은 캐시하지 말고 제어 직전 재조회한다.",
  "토픽이 미발행이거나 값이 0/이상이면, 먼저 list_running_launches로 그 토픽을 발행하는 런치/노드가 떠 있는지 확인하고 없으면 run_launch로 기동한다(중복 실행은 자체 차단됨). 런치/노드가 정상인데도 값이 이상할 때만 하드웨어(배선·죽은 셀·장치 점유 충돌)를 의심한다. 즉 '런치 먼저, 하드웨어는 마지막'.",
  "정지 요청은 무엇보다 우선한다. 움직임 전에는 정지 버튼(stop.html)이 준비됐는지 환기한다.",
  "세션/작업 시작 시 점검: 먼저 preflight(또는 health)로 확인한다. 백엔드 연결이 안 되면 사용자에게 백엔드 수동 기동(ssh james@서버 → cd ~/ros2_ws/src/w_robot_testbench → ./scripts/run_server.sh)을 안내한다. 백엔드는 되는데 로봇(zenoh·컨트롤러)이 안 떠 있으면 '로봇 기동을 먼저 하겠습니다'라고 제안하고 승인 후 profile_up _autostart로 zenoh→URDF→컨트롤러를 켠다.",
  "테스트는 노션 페이지를 받아 시작한다: 사용자가 노션 URL을 주면 notion-fetch로 실험방법·정량목표·기대표를 읽고, 그대로 실행한 뒤 결과를 그 페이지에 기입한다(상세 절차는 test_sop 도구). 노션 등 외부 쓰기는 사용자 승인 후에만.",
].join(" ");

const server = new McpServer({ name: "w_robot", version: "0.2.0" }, { instructions: INSTRUCTIONS });

// 모든 도구 실행을 세션 이벤트 로그에 자동 기록(감사/복기용). 고빈도 조회 도구는 제외.
const NOLOG = new Set([
  "get_latest", "get_recent", "watch", "list_watched", "health",
  "signal_log_status", "tail_log", "list_logs", "view_events", "analyze_log",
]);
const summarizeArgs = (a: any) => {
  try {
    const s = JSON.stringify(a);
    return s.length > 200 ? s.slice(0, 200) + "…" : s;
  } catch {
    return undefined;
  }
};
const _registerTool: any = server.registerTool.bind(server);
(server as any).registerTool = (name: string, config: any, handler: any) =>
  _registerTool(name, config, async (args: any, extra: any) => {
    const start = Date.now();
    try {
      const res = await handler(args, extra);
      if (!NOLOG.has(name)) logEvent("tool", { name, args: summarizeArgs(args), ms: Date.now() - start });
      return res;
    } catch (e) {
      logEvent("tool_error", { name, args: summarizeArgs(args), error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  });

const hub = new WsHub();
hub.onPush = signalOnPush; // 신호 로거 연결
hub.start();

registerObserve(server);
registerDiscover(server);
registerRealtime(server, hub);
registerControl(server);
registerCamera(server);
registerRecorder(server);
registerRos(server);
registerNav(server);
registerAdmin(server);
registerView(server);
registerUsbHub(server, hub);
registerTests(server);
registerLoadcell(server);
registerLogs(server, hub);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[w_robot_mcp] started. backend=${tb.base}`);
logEvent("mcp_start", { backend: tb.base });

// 시작 시 자동 오픈 (headless면 조용히 무시). 각각 env로 끄기 가능.
if (process.env.MCP_NO_STOP_PAGE !== "1") {
  try {
    const stopHtml = resolve(dirname(fileURLToPath(import.meta.url)), "..", "stop.html");
    osOpen(`file://${stopHtml}?base=${encodeURIComponent(tb.base)}`);
    console.error("[w_robot_mcp] 정지 버튼(stop.html) 자동 오픈");
  } catch {
    /* GUI 없는 환경 등 — 무시 */
  }
}
if (process.env.MCP_NO_WEB_UI !== "1") {
  try {
    osOpen(tb.base); // 테스트벤치 웹 UI 대시보드
    console.error(`[w_robot_mcp] 웹 UI 자동 오픈: ${tb.base}`);
  } catch {
    /* 무시 */
  }
}
