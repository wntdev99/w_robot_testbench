// /can_bms/status 연속 로거 — 흔들기 테스트용. 모든 샘플을 JSONL로 기록.
// 사용: node can_logger.cjs <출력파일>
const WebSocket = require("ws");
const fs = require("fs");
const URL = "ws://192.168.34.202:8080/ws";
const TOPIC = "/can_bms/status";
const TYPE = "can_bus_monitor_msgs/msg/CanBusStatus";
const out = process.argv[2] || "/tmp/can_bms_log.jsonl";

function line(o) { fs.appendFileSync(out, JSON.stringify(o) + "\n"); }

function connect() {
  const ws = new WebSocket(URL);
  ws.on("open", () => { ws.send(JSON.stringify({ op: "sub", topic: TOPIC, type: TYPE })); line({ t: Date.now(), ev: "ws_open" }); });
  ws.on("message", (raw) => {
    let m; try { m = JSON.parse(raw.toString()); } catch { return; }
    if (m.type === "topic_data" && m.data && m.data.topic === TOPIC) {
      const v = m.data.values;
      line({ t: Date.now(), alive: v.alive, present: v.present_count, rx: v.rx_packets,
        bus_off: v.bus_off, restart: v.restart_count, rx_err: v.rx_errors, tx_err: v.tx_errors,
        ew: v.error_warning, ep: v.error_passive, be: v.bus_error, al: v.arbitration_lost,
        rxd: v.rx_dropped, state: v.state_str, missing: (v.missing_ids || []).length });
    }
  });
  ws.on("close", () => { line({ t: Date.now(), ev: "ws_close" }); setTimeout(connect, 500); });
  ws.on("error", (e) => { line({ t: Date.now(), ev: "ws_error", msg: String(e && e.message || e) }); });
}
line({ t: Date.now(), ev: "logger_start" });
connect();
