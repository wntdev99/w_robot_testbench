/**
 * USB 허브 제어 (테스트 #27 — Gemini 카메라 USB HUB 제어/소생).
 * 인터페이스(Usbhub 스냅샷에서 확인):
 *  - 포트 제어: service /exsys_hub_node/set_port {port, state}
 *  - 허브 상태: topic /exsys_hub_node/hub_status (exsys_usb_hub_msgs/msg/HubStatus)
 *  - 장치 목록: topic /usb_camera_monitor/devices (generate_orbbec_launch/msg/OrbbecUsbDeviceArray) — 인식/USB 2.0·3.0
 * 포트 제어는 카메라 전원 변경이라 confirm 필수.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { tb } from "../client.js";
import { ok, humanizeError, sleep } from "../util.js";
import { WsHub } from "../realtime.js";

const SET_PORT_SVC = "/exsys_hub_node/set_port";
const HUB_STATUS = "/exsys_hub_node/hub_status";
const DEVICES = "/usb_camera_monitor/devices";
const HUB_STATUS_TYPE = "exsys_usb_hub_msgs/msg/HubStatus";
const DEVICES_TYPE = "generate_orbbec_launch/msg/OrbbecUsbDeviceArray";

export function registerUsbHub(server: McpServer, hub: WsHub) {
  server.registerTool(
    "usb_hub_status",
    {
      title: "USB 허브 상태/장치",
      description:
        "USB 허브 포트 상태 + 연결된 카메라 장치(인식/USB 2.0·3.0)를 조회. 허브/모니터 런치가 떠 있어야 함.",
      inputSchema: {},
    },
    async () => {
      try {
        await hub.subscribe(HUB_STATUS, HUB_STATUS_TYPE).catch(() => {});
        await hub.subscribe(DEVICES, DEVICES_TYPE).catch(() => {});
        await sleep(1300); // 첫 샘플 수신 대기
        const st = hub.latest(HUB_STATUS);
        const dv = hub.latest(DEVICES);
        if (!st && !dv)
          return ok(
            "허브/장치 데이터가 없습니다. 먼저 런치를 켜세요: run_launch exsys_usb_hub/exsys_hub_multi.launch.py + generate_orbbec_launch/monitors.launch.py",
          );
        return ok(
          [
            "■ 허브 상태:",
            st ? JSON.stringify(st.v) : "(없음)",
            "■ 장치 목록(인식/USB 버전):",
            dv ? JSON.stringify(dv.v) : "(없음)",
          ].join("\n"),
        );
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "usb_hub_set_port",
    {
      title: "USB 포트 제어(승인 필수)",
      description:
        "USB 허브 포트를 켜거나 끈다(카메라 개별 전원). port=포트/카메라 이름, state=true(ON)/false(OFF). confirm 필수.",
      inputSchema: {
        port: z.string().describe("포트/카메라 이름 (usb_hub_status에서 확인)"),
        state: z.boolean().describe("true=ON, false=OFF"),
        confirm: z.boolean().default(false),
      },
    },
    async ({ port, state, confirm }) => {
      if (!confirm)
        return ok(`🔌 예정: 포트 '${port}' → ${state ? "ON" : "OFF"}. 카메라 전원이 바뀝니다. 승인 시 confirm=true.`);
      try {
        // 서비스 타입을 라이브로 조회 후 호출
        const f = await tb.get<{ type: string }>(`/api/services/fields?service=${encodeURIComponent(SET_PORT_SVC)}`);
        const r = await tb.post<any>("/api/service", {
          name: SET_PORT_SVC,
          type: f.type,
          request: { port, state },
        }, 15000);
        return ok(`포트 '${port}' → ${state ? "ON" : "OFF"} 요청 완료: ${JSON.stringify(r)}`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );

  server.registerTool(
    "measure_camera_revival",
    {
      title: "카메라 소생 시간 측정",
      description:
        "포트를 ON 한 뒤 해당 카메라의 이미지 토픽이 나오기까지 걸린 시간을 측정(테스트 #27 소생시간). confirm 필수.",
      inputSchema: {
        port: z.string().describe("켤 포트/카메라 이름"),
        image_topic: z.string().describe("소생 확인할 이미지 토픽 (예: /camera/.../image_raw)"),
        timeout_s: z.number().default(20),
        confirm: z.boolean().default(false),
      },
    },
    async ({ port, image_topic, timeout_s, confirm }) => {
      if (!confirm)
        return ok(`⏱ 예정: 포트 '${port}' ON 후 '${image_topic}' 수신까지 시간 측정(최대 ${timeout_s}s). 승인 시 confirm=true.`);
      try {
        const f = await tb.get<{ type: string }>(`/api/services/fields?service=${encodeURIComponent(SET_PORT_SVC)}`);
        await hub.subscribe(image_topic).catch(() => {});
        const before = hub.latest(image_topic)?.t ?? 0;
        const t0 = Date.now();
        await tb.post("/api/service", { name: SET_PORT_SVC, type: f.type, request: { port, state: true } }, 15000);
        const deadline = t0 + timeout_s * 1000;
        while (Date.now() < deadline) {
          const l = hub.latest(image_topic);
          if (l && l.t > before && l.t >= t0) {
            return ok(`✅ 소생 확인: '${port}' ON → '${image_topic}' 수신까지 ${((l.t - t0) / 1000).toFixed(2)}초`);
          }
          await sleep(200);
        }
        return ok(`⚠ ${timeout_s}초 내 '${image_topic}' 수신 없음 — 소생 실패 또는 토픽명 확인 필요.`);
      } catch (e) {
        return ok(humanizeError(e));
      }
    },
  );
}
