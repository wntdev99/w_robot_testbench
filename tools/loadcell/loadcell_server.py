#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
로드셀 측정 대시보드 — Python 백엔드 (표준 라이브러리만)

데이터 모델
- 위치(모듈)   : 보정 단위 이름. 예: mW2_1층 / mW2_2층 / w-station   (config.json 의 locations)
- 유닛         : 위치 + 보드 시리얼. 보정·측정 파일은 유닛 단위로 분리.
- 파일 이름    : <위치>_<시리얼>.json (보정값) / <위치>_<시리얼>.csv (측정 기록)
- 저장 위치    : 사용자 지정 폴더(output_dir, config.json) — 기본은 이 스크립트 폴더
- 보정 이력    : calibration_history.csv (보정할 때마다 시각+값 누적, 덮어써도 남음)
- 제품(테스트 항목): products/<제품>.json (위치와 무관한 템플릿)

실행:  python3 loadcell_server.py  → http://localhost:8765
필요:  pip3 install Phidget22 --break-system-packages  (Control Panel 닫을 것)
"""

import json, csv, os, sys, time, re, threading, webbrowser
from datetime import datetime
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse, parse_qs

try:
    from Phidget22.Devices.VoltageRatioInput import VoltageRatioInput
    from Phidget22.Devices.Manager import Manager
    from Phidget22.BridgeGain import BridgeGain
    from Phidget22.PhidgetException import PhidgetException
except ImportError:
    print("[오류] Phidget22 모듈이 없습니다. pip3 install Phidget22 --break-system-packages")
    sys.exit(1)

# ───── 설정 ─────
PORT          = 8765
CHANNELS      = [0, 1, 2, 3]
GAIN          = BridgeGain.BRIDGE_GAIN_128
DATA_INTERVAL = 128
CH_MAX        = 25.0
SMOOTH        = 0.30
TOL_KG        = 0.5
PROD_DIR      = "products"
HISTORY_FILE  = "calibration_history.csv"
POSITIONS     = ["정중앙", "쏠림"]
HERE          = os.path.dirname(os.path.abspath(__file__))
CONFIG_FILE   = os.path.join(HERE, "config.json")
DEFAULT_LOCS  = ["mW2_1층", "mW2_2층", "w-station"]

# ───── 전역 상태 ─────
LOCK   = threading.Lock()
CONFIG = {"output_dir": HERE, "locations": list(DEFAULT_LOCS)}
DEV    = {"chans": None, "connected": False, "module": None}  # module={name, serial}
CALIB  = {"zero": [0.0]*4, "scale": [1.0]*4}
DISP   = [0.0]*4


# ───── 파일/설정 ─────
def _safe(name):
    return re.sub(r'[^\w가-힣 .()\-]', "_", str(name)).strip() or "unnamed"

def load_config():
    global CONFIG
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, encoding="utf-8") as f:
                c = json.load(f)
            CONFIG["output_dir"] = c.get("output_dir") or HERE
            CONFIG["locations"]  = c.get("locations") or list(DEFAULT_LOCS)
        except Exception:
            pass
    else:
        save_config()   # 첫 실행: 기본값으로 파일 생성(파일로도 편집 가능하게)
    os.makedirs(CONFIG["output_dir"], exist_ok=True)

def save_config():
    with open(CONFIG_FILE, "w", encoding="utf-8") as f:
        json.dump(CONFIG, f, ensure_ascii=False, indent=2)

def out_dir():
    os.makedirs(CONFIG["output_dir"], exist_ok=True)
    return CONFIG["output_dir"]

def calib_path(name, serial):
    return os.path.join(out_dir(), f"{_safe(name)}_{serial}.json")

def csv_path(name, serial):
    return os.path.join(out_dir(), f"{_safe(name)}_{serial}.csv")

def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

# 제품(템플릿)
def prod_dir():
    d = os.path.join(HERE, PROD_DIR); os.makedirs(d, exist_ok=True); return d

def list_products():
    out = []
    for fn in sorted(os.listdir(prod_dir())):
        if fn.endswith(".json"):
            try:
                with open(os.path.join(prod_dir(), fn), encoding="utf-8") as f:
                    out.append(json.load(f).get("name", fn[:-5]))
            except Exception:
                pass
    return out

def load_product(name):
    with open(os.path.join(prod_dir(), _safe(name)+".json"), encoding="utf-8") as f:
        return json.load(f)

def save_product(name, data):
    with open(os.path.join(prod_dir(), _safe(name)+".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def seed_default_product():
    if list_products():
        return
    items = [{"nominal": float(kg), "position": pos}
             for kg in (5, 10, 25, 30, 60) for pos in POSITIONS]
    save_product("기본 (절차서 STEP2/3)",
                 {"name": "기본 (절차서 STEP2/3)", "items": items})

def item_label(it):
    return f"{it['nominal']:g}kg — {it['position']}"

def to_weights(raw):
    w = [(raw[i]-CALIB["zero"][i])*CALIB["scale"][i] for i in range(len(raw))]
    return w, sum(w)


# ───── 보정값 저장/이력 ─────
def save_calib_file(step):
    """현재 유닛의 보정 json을 덮어쓰고, 이력 csv에 한 줄 누적."""
    m = DEV["module"]
    if not m:
        return
    data = {"module": m["name"], "serial": m["serial"],
            "zero": list(CALIB["zero"]), "scale": list(CALIB["scale"]),
            "updated": now_str()}
    with open(calib_path(m["name"], m["serial"]), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    # 이력 누적
    hist = os.path.join(out_dir(), HISTORY_FILE)
    new = not os.path.exists(hist)
    row = {"시각": now_str(), "모듈": m["name"], "시리얼": m["serial"], "단계": step,
           "zero0": CALIB["zero"][0], "zero1": CALIB["zero"][1],
           "zero2": CALIB["zero"][2], "zero3": CALIB["zero"][3],
           "scale0": CALIB["scale"][0], "scale1": CALIB["scale"][1],
           "scale2": CALIB["scale"][2], "scale3": CALIB["scale"][3]}
    with open(hist, "a", newline="", encoding="utf-8-sig") as f:
        wr = csv.DictWriter(f, fieldnames=list(row.keys()))
        if new: wr.writeheader()
        wr.writerow(row)


# ───── 하드웨어 ─────
def detect_serials(timeout=1.2):
    found = {}
    def on_attach(m, ch):
        try: found.setdefault(ch.getDeviceSerialNumber(), ch.getDeviceName())
        except PhidgetException: pass
    mgr = Manager(); mgr.setOnAttachHandler(on_attach)
    try:
        mgr.open(); time.sleep(timeout)
    finally:
        try: mgr.close()
        except PhidgetException: pass
    bridges = [[s, n] for s, n in found.items() if "Bridge" in n]
    return bridges if bridges else [[s, n] for s, n in found.items()]

def hw_connect(serial):
    chans = []
    for c in CHANNELS:
        v = VoltageRatioInput()
        v.setDeviceSerialNumber(int(serial)); v.setChannel(c)
        v.openWaitForAttachment(5000); v.setBridgeGain(GAIN)
        try: v.setDataInterval(DATA_INTERVAL)
        except PhidgetException: v.setDataInterval(v.getMinDataInterval())
        chans.append(v)
    time.sleep(0.4)
    return chans

def hw_close():
    DEV["connected"] = False
    if DEV["chans"]:
        for v in DEV["chans"]:
            try: v.close()
            except PhidgetException: pass
    DEV["chans"] = None

def read_avg(samples=20, interval=0.02):
    acc = [0.0]*4
    for _ in range(samples):
        for i, v in enumerate(DEV["chans"]):
            acc[i] += v.getVoltageRatio()
        time.sleep(interval)
    return [a/samples for a in acc]

def _require_conn():
    return DEV["connected"] and DEV["chans"]


# ───── API ─────
def api_state():
    m = DEV["module"]
    return {"connected": DEV["connected"],
            "module": m["name"] if m else None,
            "serial": m["serial"] if m else None,
            "locations": CONFIG["locations"], "products": list_products(),
            "positions": POSITIONS, "ch_max": CH_MAX, "tol": TOL_KG,
            "output_dir": CONFIG["output_dir"]}

def api_calib():
    m = DEV["module"]
    if not m: return {"connected": False}
    return {"connected": True, "module": m["name"], "serial": m["serial"],
            "zero": CALIB["zero"], "scale": CALIB["scale"],
            "file": os.path.basename(calib_path(m["name"], m["serial"]))}

def api_reading():
    if not _require_conn():
        return {"connected": False}
    try:
        for i, v in enumerate(DEV["chans"]):
            r = v.getVoltageRatio(); DISP[i] += SMOOTH*(r - DISP[i])
        w, total = to_weights(DISP)
        return {"connected": True, "total": total, "ch": [round(x, 3) for x in w],
                "vv": [DISP[i] for i in range(4)], "over": max(w) > CH_MAX, "ch_max": CH_MAX}
    except PhidgetException:
        hw_close()
        return {"connected": False, "error": "장치 연결이 끊겼습니다."}

def api_connect(body):
    name = body.get("name")
    if not name or name not in CONFIG["locations"]:
        return {"ok": False, "error": "위치(모듈)를 선택하세요."}
    serial = body.get("serial")
    if not serial:
        det = detect_serials()
        if len(det) == 1:
            serial = det[0][0]
        else:
            return {"ok": False, "needs_serial": True, "detected": det}
    hw_close()
    try:
        DEV["chans"] = hw_connect(serial)
    except PhidgetException as e:
        return {"ok": False, "error": f"{e.details} (시리얼 {serial}·USB·Control Panel 확인)"}
    DEV["module"] = {"name": name, "serial": int(serial)}
    DEV["connected"] = True
    # 기존 보정 파일 있으면 로드, 없으면 기본값
    p = calib_path(name, serial)
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            d = json.load(f)
        CALIB["zero"] = list(d.get("zero", [0.0]*4)); CALIB["scale"] = list(d.get("scale", [1.0]*4))
    else:
        CALIB["zero"] = [0.0]*4; CALIB["scale"] = [1.0]*4
    for i in range(4): DISP[i] = 0.0
    return {"ok": True, "module": name, "serial": int(serial),
            "loaded": os.path.exists(p)}

def api_disconnect(body):
    hw_close(); DEV["module"] = None
    return {"ok": True}

def api_location_new(body):
    name = (body.get("name") or "").strip()
    if not name: return {"ok": False, "error": "위치 이름을 입력하세요."}
    if name in CONFIG["locations"]: return {"ok": False, "error": "이미 있는 위치입니다."}
    CONFIG["locations"].append(name); save_config()
    return {"ok": True, "name": name}

def api_set_output(body):
    path = (body.get("path") or "").strip()
    if not path: return {"ok": False, "error": "폴더 경로를 입력하세요."}
    path = os.path.abspath(os.path.expanduser(path))
    try:
        os.makedirs(path, exist_ok=True)
    except Exception as e:
        return {"ok": False, "error": f"폴더 생성 실패: {e}"}
    CONFIG["output_dir"] = path; save_config()
    return {"ok": True, "output_dir": path}

def api_detect(body=None):
    return {"detected": detect_serials()}

def api_product_get(name):
    return load_product(name)

def api_product_save(body):
    name = (body.get("name") or "").strip()
    if not name: return {"ok": False, "error": "제품 이름을 입력하세요."}
    items = []
    for it in body.get("items", []):
        try: kg = float(it["nominal"])
        except (ValueError, KeyError, TypeError):
            return {"ok": False, "error": f"무게 값 오류: {it}"}
        items.append({"nominal": kg, "position": it.get("position") or "정중앙"})
    if not items: return {"ok": False, "error": "항목을 1개 이상 추가하세요."}
    old = body.get("oldName")
    if old and old != name:
        p = os.path.join(prod_dir(), _safe(old)+".json")
        if os.path.exists(p): os.remove(p)
    save_product(name, {"name": name, "items": items})
    return {"ok": True, "name": name}

def api_tare(body):
    if not _require_conn(): return {"ok": False, "error": "먼저 연결하세요."}
    CALIB["zero"] = read_avg(); save_calib_file("영점")
    return {"ok": True, "msg": "영점 설정 완료"}

def api_span(body):
    if not _require_conn(): return {"ok": False, "error": "먼저 연결하세요."}
    try: kn = float(body.get("kg"))
    except (TypeError, ValueError): return {"ok": False, "error": "기준무게(kg)를 입력하세요."}
    raw = read_avg()
    ds = sum(raw[i]-CALIB["zero"][i] for i in range(4))
    if abs(ds) < 1e-9: return {"ok": False, "error": "신호 변화가 너무 작습니다. 영점/배선 확인."}
    k = kn/ds; CALIB["scale"] = [k]*4; save_calib_file("스팬")
    return {"ok": True, "msg": f"스팬 완료 (공통 스케일 {k:.4g})"}

def api_corner(body):
    if not _require_conn(): return {"ok": False, "error": "먼저 연결하세요."}
    try: kn = float(body.get("kg")); ch = int(body.get("channel"))
    except (TypeError, ValueError): return {"ok": False, "error": "코너 무게/채널 오류."}
    raw = read_avg()
    d = raw[ch]-CALIB["zero"][ch]
    if abs(d) < 1e-9: return {"ok": False, "error": f"ch{ch} 변화량이 너무 작습니다."}
    sc = list(CALIB["scale"]); sc[ch] = kn/d; CALIB["scale"] = sc; save_calib_file(f"코너 ch{ch}")
    return {"ok": True, "msg": f"ch{ch} 코너 보정 완료"}

def api_record(body):
    if not _require_conn(): return {"ok": False, "error": "먼저 연결하세요."}
    pname = body.get("product"); idx = body.get("index")
    if not pname or idx is None: return {"ok": False, "error": "제품/항목 누락."}
    prod = load_product(pname)
    it = prod["items"][int(idx)]
    nominal, position = it["nominal"], it["position"]
    label = item_label(it)
    raw = read_avg(); w, total = to_weights(raw)
    err = total - nominal
    verdict = "PASS" if abs(err) <= TOL_KG else "FAIL"
    m = DEV["module"]
    row = {"시각": now_str(), "모듈": m["name"], "시리얼": m["serial"],
           "제품": pname, "항목": label, "기대무게": f"{nominal:g}", "위치": position,
           "측정무게": f"{total:.2f}", "오차": f"{err:+.2f}", "판정": verdict,
           "ch0": f"{w[0]:.2f}", "ch1": f"{w[1]:.2f}", "ch2": f"{w[2]:.2f}", "ch3": f"{w[3]:.2f}"}
    path = csv_path(m["name"], m["serial"])
    new = not os.path.exists(path)
    with open(path, "a", newline="", encoding="utf-8-sig") as f:
        wr = csv.DictWriter(f, fieldnames=list(row.keys()))
        if new: wr.writeheader()
        wr.writerow(row)
    return {"ok": True, "total": round(total, 2), "err": round(err, 2),
            "verdict": verdict, "over": max(w) > CH_MAX,
            "file": os.path.basename(path)}


POST_ROUTES = {
    "/api/connect": api_connect, "/api/disconnect": api_disconnect,
    "/api/location/new": api_location_new, "/api/output": api_set_output,
    "/api/detect": api_detect, "/api/product/save": api_product_save,
    "/api/tare": api_tare, "/api/span": api_span, "/api/corner": api_corner,
    "/api/record": api_record,
}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *a): pass

    def _send(self, obj, code=200, ctype="application/json"):
        if isinstance(obj, (dict, list)):
            data = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        else:
            data = obj if isinstance(obj, bytes) else str(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype + "; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        u = urlparse(self.path)
        if u.path in ("/", "/index.html"):
            try:
                with open(os.path.join(HERE, "index.html"), "rb") as f:
                    return self._send(f.read(), ctype="text/html")
            except FileNotFoundError:
                return self._send("index.html 없음", 404, "text/plain")
        with LOCK:
            if u.path == "/api/state":   return self._send(api_state())
            if u.path == "/api/reading": return self._send(api_reading())
            if u.path == "/api/calib":   return self._send(api_calib())
            if u.path == "/api/product":
                q = parse_qs(u.query)
                return self._send(api_product_get(q.get("name", [""])[0]))
        self._send("not found", 404, "text/plain")

    def do_POST(self):
        u = urlparse(self.path)
        fn = POST_ROUTES.get(u.path)
        if not fn: return self._send("not found", 404, "text/plain")
        ln = int(self.headers.get("Content-Length") or 0)
        body = {}
        if ln:
            try: body = json.loads(self.rfile.read(ln).decode("utf-8"))
            except Exception: body = {}
        with LOCK:
            try: return self._send(fn(body))
            except Exception as e: return self._send({"ok": False, "error": str(e)}, 200)


def main():
    load_config(); seed_default_product()
    # LAN에서 읽을 수 있도록 0.0.0.0 바인드(로봇 PC/MCP가 원격으로 측정값 수신).
    # 단일 PC 전용으로 쓰려면 LOADCELL_BIND=127.0.0.1 로 제한 가능.
    import os as _os
    bind = _os.environ.get("LOADCELL_BIND", "0.0.0.0")
    srv = ThreadingHTTPServer((bind, PORT), Handler)
    url = f"http://localhost:{PORT}"
    print(f"로드셀 대시보드 실행: http://{bind}:{PORT}  (브라우저: {url})  (저장 폴더: {CONFIG['output_dir']})  Ctrl+C 종료")
    try: webbrowser.open(url)
    except Exception: pass
    try: srv.serve_forever()
    except KeyboardInterrupt: pass
    finally: hw_close(); srv.server_close()


if __name__ == "__main__":
    main()
