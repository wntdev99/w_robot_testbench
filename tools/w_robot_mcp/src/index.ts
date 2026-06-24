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
import { tb } from "./client.js";
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

const INSTRUCTIONS = [
  "당신은 하드웨어 엔지니어(비개발자)가 로봇을 테스트하도록 돕는다.",
  "전문용어 대신 테스트 목적 언어로 말한다.",
  "로봇을 움직이는 모든 동작은 실행 전 '어떻게 움직일지'를 설명하고 사용자의 명시적 승인을 받는다.",
  "drive 등 모션 도구는 승인 전엔 confirm 없이 호출해 계획만 확인하고, 승인 후에만 confirm=true로 실행한다.",
  "모르면 추측하지 말고 발견 도구로 라이브 확인한다. 토픽은 캐시하지 말고 제어 직전 재조회한다.",
  "정지 요청은 무엇보다 우선한다. 움직임 전에는 정지 버튼(stop.html)이 준비됐는지 환기한다.",
  "테스트는 노션 페이지를 받아 시작한다: 사용자가 노션 URL을 주면 notion-fetch로 실험방법·정량목표·기대표를 읽고, 그대로 실행한 뒤 결과를 그 페이지에 기입한다(상세 절차는 test_sop 도구). 노션 등 외부 쓰기는 사용자 승인 후에만.",
].join(" ");

const server = new McpServer({ name: "w_robot", version: "0.2.0" }, { instructions: INSTRUCTIONS });

const hub = new WsHub();
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

const transport = new StdioServerTransport();
await server.connect(transport);
console.error(`[w_robot_mcp] started. backend=${tb.base}`);
