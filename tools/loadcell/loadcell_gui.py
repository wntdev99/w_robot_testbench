#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
로드셀 4채널 측정 대시보드(GUI) — 모듈별 보정 + 제품별 테스트 항목

- 장비: PhidgetBridge 1046, 채널 0~3, 게인 128x
- 모듈(보정 단위): 이름 + 보드 시리얼로 구분. 모듈마다 영점/배율을 따로 저장
    → calibrations/<모듈>.json
- 제품(테스트 대상): 제품마다 테스트 항목(무게×위치)을 따로 저장. GUI에서 직접 편집
    → products/<제품>.json
- 측정 기록: measurements.csv (모듈·시리얼·제품·항목 태그 포함)

준비:
    pip3 install Phidget22 --break-system-packages
    (Tkinter는 파이썬 기본 내장)
    실행 전 Phidget Control Panel 은 반드시 닫을 것.
실행:
    python3 loadcell_gui.py
"""

import json, csv, os, sys, time, re
from datetime import datetime
import tkinter as tk
from tkinter import ttk, simpledialog, messagebox

try:
    from Phidget22.Devices.VoltageRatioInput import VoltageRatioInput
    from Phidget22.Devices.Manager import Manager
    from Phidget22.BridgeGain import BridgeGain
    from Phidget22.PhidgetException import PhidgetException
except ImportError:
    print("[오류] Phidget22 모듈이 없습니다. pip3 install Phidget22 --break-system-packages")
    sys.exit(1)

# ───── 설정 ─────
CHANNELS      = [0, 1, 2, 3]
GAIN          = BridgeGain.BRIDGE_GAIN_128
DATA_INTERVAL = 128            # ms (8의 배수)
CH_MAX        = 25.0           # 채널 막대 최대·정격 초과 경고 기준(kg)
SMOOTH        = 0.30           # 표시 평활 계수
TOL_KG        = 0.5           # 합격 허용오차(kg)
CAL_DIR       = "calibrations"
PROD_DIR      = "products"
CSV_FILE      = "measurements.csv"
POSITIONS     = ["정중앙", "쏠림"]

# 현재 연결된 모듈의 보정값(메모리). to_weights()가 참조.
calib = {"zero": [0.0]*4, "scale": [1.0]*4}


# ───── 파일/데이터 ─────
def _safe(name):
    return re.sub(r'[^\w가-힣 .()\-]', "_", name).strip() or "unnamed"

def ensure_dirs():
    for d in (CAL_DIR, PROD_DIR):
        os.makedirs(d, exist_ok=True)

def list_names(folder):
    if not os.path.isdir(folder):
        return []
    out = []
    for fn in sorted(os.listdir(folder)):
        if fn.endswith(".json"):
            try:
                with open(os.path.join(folder, fn), encoding="utf-8") as f:
                    out.append(json.load(f).get("name", fn[:-5]))
            except Exception:
                pass
    return out

def load_json(folder, name):
    with open(os.path.join(folder, _safe(name) + ".json"), encoding="utf-8") as f:
        return json.load(f)

def save_json(folder, name, data):
    ensure_dirs()
    with open(os.path.join(folder, _safe(name) + ".json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

def now_str():
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def seed_default_product():
    """제품이 하나도 없으면 절차서 STEP2/3 기본 제품을 만든다."""
    if list_names(PROD_DIR):
        return
    items = []
    for kg in (5, 10, 25, 30, 60):
        for pos in POSITIONS:
            items.append({"nominal": float(kg), "position": pos})
    save_json(PROD_DIR, "기본 (절차서 STEP2/3)",
              {"name": "기본 (절차서 STEP2/3)", "items": items})


def to_weights(raw):
    w = [(raw[i]-calib["zero"][i])*calib["scale"][i] for i in range(len(raw))]
    return w, sum(w)


# ───── 장치 ─────
def detect_serials(timeout=1.2):
    """USB에 붙은 Phidget 보드 시리얼을 스캔. [(serial, 이름), …]"""
    found = {}
    def on_attach(m, ch):
        try:
            found.setdefault(ch.getDeviceSerialNumber(), ch.getDeviceName())
        except PhidgetException:
            pass
    mgr = Manager()
    mgr.setOnAttachHandler(on_attach)
    try:
        mgr.open(); time.sleep(timeout)
    finally:
        try: mgr.close()
        except PhidgetException: pass
    bridges = [(s, n) for s, n in found.items() if "Bridge" in n]
    return bridges if bridges else list(found.items())


def connect(serial):
    chans = []
    for c in CHANNELS:
        v = VoltageRatioInput()
        v.setDeviceSerialNumber(int(serial))
        v.setChannel(c)
        v.openWaitForAttachment(5000)
        v.setBridgeGain(GAIN)
        try:
            v.setDataInterval(DATA_INTERVAL)
        except PhidgetException:
            v.setDataInterval(v.getMinDataInterval())
        chans.append(v)
    time.sleep(0.4)
    return chans

def read_avg(chans, samples=20, interval=0.02):
    acc = [0.0]*len(chans)
    for _ in range(samples):
        for i, v in enumerate(chans):
            acc[i] += v.getVoltageRatio()
        time.sleep(interval)
    return [a/samples for a in acc]


# ───── GUI ─────
BG      = "#1e1e22"
PANEL   = "#26262b"
class App:
    def __init__(self, root):
        self.root = root
        self.chans = None
        self.connected = False
        self.module = None        # 현재 모듈 dict
        self.product = None       # 현재 제품 dict
        self.disp = [0.0]*4
        self.item_w = []

        root.title("로드셀 측정 대시보드 — 모듈/제품")
        root.configure(bg=BG)
        root.geometry("680x1010")

        # ── 선택 바: 모듈 / 제품 ──
        sel = tk.Frame(root, bg=PANEL); sel.pack(fill="x", padx=16, pady=(12, 4))
        # 모듈
        m = tk.Frame(sel, bg=PANEL); m.pack(fill="x", padx=10, pady=(10, 4))
        tk.Label(m, text="모듈(보정 단위)", fg="#e6e6e6", bg=PANEL,
                 font=("Helvetica", 11, "bold"), width=14, anchor="w").pack(side="left")
        self.mod_cb = ttk.Combobox(m, state="readonly", width=16,
                                   values=list_names(CAL_DIR))
        self.mod_cb.pack(side="left", padx=(0, 6))
        self._pill(m, "연결", self.connect_module, "#2F6FED", "#1E4FB0",
                   font=("Helvetica", 10, "bold"), padx=10, pady=5).pack(side="left", padx=2)
        self._pill(m, "새 모듈", self.new_module, "#3a3a40", "#4a4a52",
                   font=("Helvetica", 10, "bold"), padx=10, pady=5).pack(side="left", padx=2)
        self._pill(m, "시리얼", self.change_serial, "#3a3a40", "#4a4a52",
                   font=("Helvetica", 10, "bold"), padx=10, pady=5).pack(side="left", padx=2)
        self.conn_lbl = tk.Label(m, text="● 미연결", fg="#E06A50", bg=PANEL,
                                 font=("Helvetica", 10, "bold"))
        self.conn_lbl.pack(side="left", padx=8)
        # 제품
        p = tk.Frame(sel, bg=PANEL); p.pack(fill="x", padx=10, pady=(2, 10))
        tk.Label(p, text="제품(테스트 대상)", fg="#e6e6e6", bg=PANEL,
                 font=("Helvetica", 11, "bold"), width=14, anchor="w").pack(side="left")
        self.prod_cb = ttk.Combobox(p, state="readonly", width=22,
                                    values=list_names(PROD_DIR))
        self.prod_cb.pack(side="left", padx=(0, 6))
        self.prod_cb.bind("<<ComboboxSelected>>", lambda e: self.load_product())
        self._pill(p, "새 제품", lambda: self.edit_product(None), "#14A88B", "#0E7A65",
                   font=("Helvetica", 10, "bold"), padx=12, pady=5).pack(side="left", padx=3)
        self._pill(p, "항목 편집", self.edit_current_product, "#E08A1E", "#A86413",
                   font=("Helvetica", 10, "bold"), padx=12, pady=5).pack(side="left", padx=3)

        # ── 총 무게 ──
        tk.Label(root, text="총 무게", fg="#aaa", bg=BG, font=("Helvetica", 13)).pack(pady=(10, 0))
        self.total_lbl = tk.Label(root, text="—", fg="#5DCAA5", bg=BG,
                                  font=("Helvetica", 50, "bold"))
        self.total_lbl.pack()
        self.status = tk.Label(root, text="모듈을 선택해 연결하세요", fg="#888", bg=BG,
                               font=("Helvetica", 11))
        self.status.pack()

        # ── 채널 막대 ──
        cf = tk.Frame(root, bg=BG); cf.pack(pady=8, fill="x", padx=24)
        self.bars, self.ch_lbl, self.vv_lbl = [], [], []
        for i, c in enumerate(CHANNELS):
            row = tk.Frame(cf, bg=BG); row.pack(fill="x", pady=3)
            tk.Label(row, text=f"ch{c}", fg="#ddd", bg=BG,
                     font=("Helvetica", 12, "bold"), width=4).pack(side="left")
            cv = tk.Canvas(row, height=20, bg="#2c2c30", highlightthickness=0)
            cv.pack(side="left", fill="x", expand=True, padx=8)
            bar = cv.create_rectangle(0, 0, 0, 20, fill="#7F77DD", width=0)
            self.bars.append((cv, bar))
            kg = tk.Label(row, text="—", fg="#fff", bg=BG,
                          font=("Helvetica", 11), width=9, anchor="e")
            kg.pack(side="left"); self.ch_lbl.append(kg)
            vv = tk.Label(row, text="", fg="#777", bg=BG,
                          font=("Helvetica", 9), width=11, anchor="e")
            vv.pack(side="left"); self.vv_lbl.append(vv)

        # ── 캘리브레이션 버튼 ──
        bf = tk.Frame(root, bg=BG); bf.pack(pady=(12, 2))
        for txt, cmd, bg, active in [
            ("① 영점",     self.tare,   "#2F6FED", "#1E4FB0"),
            ("② 스팬",     self.span,   "#14A88B", "#0E7A65"),
            ("③ 코너 보정", self.corner, "#E08A1E", "#A86413"),
        ]:
            self._pill(bf, txt, cmd, bg, active,
                       font=("Helvetica", 12, "bold"), padx=16, pady=8).pack(side="left", padx=6)

        guide = tk.Frame(root, bg=PANEL); guide.pack(fill="x", padx=20, pady=(8, 4))
        tk.Label(guide, text="캘리브레이션 — 현재 모듈에 ①→②→③ 순서로 1회 (모듈마다 따로 저장)",
                 fg="#e6e6e6", bg=PANEL, font=("Helvetica", 11, "bold"),
                 anchor="w").pack(fill="x", padx=12, pady=(8, 4))
        for num, col, name, why in [
            ("①", "#2F6FED", "영점(Tare)", "빈 상태를 0kg 기준으로. 컨베이어 비우고 [① 영점]."),
            ("②", "#14A88B", "스팬(Span)", "신호→kg 배율 결정. 정중앙에 기준무게(≥30kg) 올리고 [② 스팬]→무게 입력."),
            ("③", "#E08A1E", "코너 보정", "쏠림 정확도용 채널별 미세조정. 각 코너(ch0~3)에 차례로 올리며 [③]."),
        ]:
            r = tk.Frame(guide, bg=PANEL); r.pack(fill="x", padx=12, pady=1)
            tk.Label(r, text=num, fg=col, bg=PANEL, font=("Helvetica", 11, "bold"),
                     width=2).pack(side="left", anchor="n")
            tk.Label(r, text=name, fg=col, bg=PANEL, font=("Helvetica", 10, "bold"),
                     width=10, anchor="w").pack(side="left", anchor="n")
            tk.Label(r, text=why, fg="#bcbcc4", bg=PANEL, font=("Helvetica", 10),
                     anchor="w", justify="left", wraplength=480).pack(side="left", fill="x", expand=True)
        tk.Label(guide, text="", bg=PANEL, font=("Helvetica", 3)).pack()

        # ── 테스트 항목 표 ──
        self.tbl_title = tk.Label(root, text="테스트 항목", fg="#e6e6e6", bg=BG,
                                  font=("Helvetica", 12, "bold"))
        self.tbl_title.pack(pady=(10, 2))
        self.tbl = tk.Frame(root, bg=PANEL); self.tbl.pack(fill="x", padx=20, pady=(2, 12))

        # 초기 제품 선택
        names = list_names(PROD_DIR)
        if names:
            self.prod_cb.set(names[0]); self.load_product()
        else:
            self.build_table()

        self.root.protocol("WM_DELETE_WINDOW", self.on_close)
        self.update()

    # 색이 확실히 먹는 Label 기반 버튼 (macOS tk.Button은 bg 무시)
    def _pill(self, parent, text, cmd, bg, active, fg="#ffffff",
              font=("Helvetica", 12, "bold"), padx=14, pady=8):
        lbl = tk.Label(parent, text=text, bg=bg, fg=fg, font=font,
                       padx=padx, pady=pady, cursor="hand2")
        def on_enter(e): lbl.config(bg=active)
        def on_leave(e): lbl.config(bg=bg)
        def on_release(e):
            # 좌표로 위젯 안에서 뗐는지 판정 (hover 이벤트에 의존하지 않음)
            inside = (0 <= e.x < lbl.winfo_width()) and (0 <= e.y < lbl.winfo_height())
            lbl.config(bg=active if inside else bg)
            if inside:
                cmd()
        lbl.bind("<Enter>", on_enter)
        lbl.bind("<Leave>", on_leave)
        lbl.bind("<ButtonRelease-1>", on_release)
        return lbl

    # 시리얼 입력 — 자동 인식 우선, 안되면 수동
    def _ask_serial(self, name, current=0):
        self.status.config(text="보드 시리얼 자동 인식 중…", fg="#888")
        self.root.update_idletasks()
        serials = detect_serials()
        if len(serials) == 1:
            s, dev = serials[0]
            if messagebox.askyesno("시리얼 자동 인식",
                    f"감지된 보드: {s}  ({dev})\n\n'{name}' 모듈에 이 시리얼을 쓸까요?",
                    parent=self.root):
                return s
        elif len(serials) > 1:
            lst = "\n".join(f"  • {s}  ({dev})" for s, dev in serials)
            ans = simpledialog.askinteger("시리얼 선택",
                f"여러 보드가 감지됨:\n{lst}\n\n사용할 시리얼을 입력하세요:", parent=self.root)
            if ans:
                return ans
        else:
            messagebox.showinfo("자동 인식",
                "감지된 보드가 없습니다.\n(USB 연결·Control Panel 종료 확인)\n\n시리얼을 직접 입력하세요.",
                parent=self.root)
        return simpledialog.askinteger("시리얼 입력",
            f"'{name}' 보드 시리얼 번호 (0=미정):", parent=self.root,
            initialvalue=current or None)

    # ── 모듈 ──
    def new_module(self):
        name = simpledialog.askstring("새 모듈", "모듈 이름 (예: 1층, 2층):", parent=self.root)
        if not name: return
        if name in list_names(CAL_DIR):
            messagebox.showwarning("중복", f"'{name}' 모듈이 이미 있습니다."); return
        serial = self._ask_serial(name)
        if not serial: return
        save_json(CAL_DIR, name, {"name": name, "serial": int(serial),
                                  "zero": [0.0]*4, "scale": [1.0]*4, "updated": now_str()})
        self.mod_cb["values"] = list_names(CAL_DIR)
        self.mod_cb.set(name)
        self.status.config(text=f"모듈 '{name}'(S/N {serial}) 등록됨. [연결]을 누르세요.", fg="#888")

    def change_serial(self):
        name = self.mod_cb.get()
        if not name:
            messagebox.showinfo("모듈", "먼저 모듈을 선택하세요."); return
        mod = load_json(CAL_DIR, name)
        cur = mod.get("serial") or 0
        serial = self._ask_serial(name, cur)
        if serial is None: return
        mod["serial"] = int(serial); save_json(CAL_DIR, name, mod)
        if self.module and self.module["name"] == name:
            self.module["serial"] = int(serial)
        self.status.config(
            text=f"'{name}' 시리얼 → {serial or '미정'} 저장됨. 적용하려면 [연결]을 누르세요.", fg="#888")

    def connect_module(self):
        name = self.mod_cb.get()
        if not name:
            messagebox.showinfo("모듈", "먼저 모듈을 선택하거나 [새 모듈]로 등록하세요."); return
        mod = load_json(CAL_DIR, name)
        # 시리얼 미정(0)이면 연결 시점에 받아 저장 — 유닛마다 보드가 달라지는 경우 대응
        if not mod.get("serial"):
            serial = self._ask_serial(name)
            if not serial: return
            mod["serial"] = int(serial); save_json(CAL_DIR, name, mod)
        self._close_chans()
        self.status.config(text=f"'{name}' (S/N {mod['serial']}) 연결 중…", fg="#888")
        self.root.update_idletasks()
        try:
            self.chans = connect(mod["serial"])
        except PhidgetException as e:
            self.connected = False
            self.conn_lbl.config(text="● 미연결", fg="#E06A50")
            messagebox.showerror("연결 실패",
                f"{e.details}\n\nControl Panel을 닫았는지, 시리얼({mod['serial']})·USB 연결을 확인하세요.")
            return
        self.module = mod
        global calib
        calib = {"zero": list(mod["zero"]), "scale": list(mod["scale"])}
        self.connected = True
        self.conn_lbl.config(text=f"● 연결됨", fg="#5DCAA5")
        self.status.config(text=f"모듈 '{name}' (S/N {mod['serial']}) 연결됨", fg="#5DCAA5")

    def _close_chans(self):
        self.connected = False
        if self.chans:
            for v in self.chans:
                try: v.close()
                except PhidgetException: pass
        self.chans = None

    def _save_module(self):
        if not self.module: return
        self.module["zero"] = list(calib["zero"])
        self.module["scale"] = list(calib["scale"])
        self.module["updated"] = now_str()
        save_json(CAL_DIR, self.module["name"], self.module)

    def _require_conn(self):
        if not self.connected:
            messagebox.showinfo("미연결", "먼저 모듈을 [연결]하세요."); return False
        return True

    # ── 제품/항목 ──
    def load_product(self):
        name = self.prod_cb.get()
        if not name:
            self.product = None; self.build_table(); return
        self.product = load_json(PROD_DIR, name)
        self.build_table()

    def edit_current_product(self):
        if not self.product:
            messagebox.showinfo("제품", "편집할 제품을 먼저 선택하세요."); return
        self.edit_product(self.product)

    def build_table(self):
        for w in self.tbl.winfo_children():
            w.destroy()
        self.item_w = []
        if not self.product:
            self.tbl_title.config(text="테스트 항목 — 제품을 선택하거나 [새 제품]을 만드세요")
            tk.Label(self.tbl, text="(제품 없음)", fg="#888", bg=PANEL,
                     font=("Helvetica", 11)).grid(row=0, column=0, padx=12, pady=12)
            return
        self.tbl_title.config(
            text=f"테스트 항목 — {self.product['name']}  ·  올리고 행 [기록] (합격 ±{TOL_KG}kg)")
        hdr = ["항목", "측정", "오차", "판정", ""]
        widths = [16, 9, 8, 6, 7]
        for col, (h, wd) in enumerate(zip(hdr, widths)):
            tk.Label(self.tbl, text=h, fg="#9a9aa2", bg=PANEL,
                     font=("Helvetica", 10, "bold"), width=wd,
                     anchor="center").grid(row=0, column=col, padx=2, pady=(8, 4))
        self.tbl.grid_columnconfigure(0, weight=1)
        for i, it in enumerate(self.product["items"]):
            r = i + 1
            bgc = PANEL if i % 2 == 0 else "#2c2c33"
            label = self._item_label(it)
            tk.Label(self.tbl, text=label, fg="#fff", bg=bgc, font=("Helvetica", 11),
                     width=16, anchor="w").grid(row=r, column=0, padx=2, pady=2, sticky="we")
            meas = tk.Label(self.tbl, text="—", fg="#ccc", bg=bgc, font=("Helvetica", 11),
                            width=9, anchor="e"); meas.grid(row=r, column=1, padx=2, sticky="we")
            err = tk.Label(self.tbl, text="—", fg="#ccc", bg=bgc, font=("Helvetica", 11),
                           width=8, anchor="e"); err.grid(row=r, column=2, padx=2, sticky="we")
            verd = tk.Label(self.tbl, text="—", fg="#888", bg=bgc, font=("Helvetica", 11, "bold"),
                            width=6, anchor="center"); verd.grid(row=r, column=3, padx=2, sticky="we")
            self._pill(self.tbl, "기록", lambda idx=i: self.record_item(idx),
                       "#7C5CDB", "#5A40A8", font=("Helvetica", 10, "bold"),
                       padx=12, pady=4).grid(row=r, column=4, padx=4, pady=2)
            self.item_w.append({"meas": meas, "err": err, "verd": verd})

    @staticmethod
    def _item_label(it):
        return f"{it['nominal']:g}kg — {it['position']}"

    def edit_product(self, product):
        """제품 추가/편집 창. product=None이면 새 제품."""
        win = tk.Toplevel(self.root); win.title("제품 편집"); win.configure(bg=BG)
        win.geometry("420x520"); win.transient(self.root); win.grab_set()
        is_new = product is None
        data = product or {"name": "", "items": []}

        tk.Label(win, text="제품 이름", fg="#e6e6e6", bg=BG,
                 font=("Helvetica", 11, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        name_var = tk.StringVar(value=data.get("name", ""))
        tk.Entry(win, textvariable=name_var, font=("Helvetica", 12)).pack(
            fill="x", padx=16)

        tk.Label(win, text="테스트 항목 (무게 kg · 위치)", fg="#e6e6e6", bg=BG,
                 font=("Helvetica", 11, "bold")).pack(anchor="w", padx=16, pady=(14, 2))
        rows_frame = tk.Frame(win, bg=BG); rows_frame.pack(fill="both", expand=True, padx=16)
        rows = []   # (kg_var, pos_var, frame)

        def add_row(nominal="", position="정중앙"):
            rf = tk.Frame(rows_frame, bg=BG); rf.pack(fill="x", pady=2)
            kv = tk.StringVar(value=("" if nominal == "" else f"{nominal:g}"))
            pv = tk.StringVar(value=position)
            tk.Entry(rf, textvariable=kv, width=8, font=("Helvetica", 11)).pack(side="left")
            tk.Label(rf, text="kg", fg="#aaa", bg=BG).pack(side="left", padx=(2, 8))
            ttk.Combobox(rf, textvariable=pv, values=POSITIONS, width=10).pack(side="left")
            entry = {"kv": kv, "pv": pv, "rf": rf}
            self._pill(rf, "삭제", lambda: (rf.destroy(), rows.remove(entry)),
                       "#7a3a3a", "#9a4a4a", font=("Helvetica", 9, "bold"),
                       padx=8, pady=2).pack(side="left", padx=8)
            rows.append(entry)

        for it in data.get("items", []):
            add_row(it["nominal"], it["position"])
        if not data.get("items"):
            add_row()

        btns = tk.Frame(win, bg=BG); btns.pack(fill="x", padx=16, pady=12)
        self._pill(btns, "행 추가", lambda: add_row(), "#3a3a40", "#4a4a52",
                   font=("Helvetica", 10, "bold"), padx=12, pady=5).pack(side="left")

        def save():
            nm = name_var.get().strip()
            if not nm:
                messagebox.showwarning("이름", "제품 이름을 입력하세요.", parent=win); return
            items = []
            for e in rows:
                s = e["kv"].get().strip()
                if not s: continue
                try:
                    kg = float(s)
                except ValueError:
                    messagebox.showwarning("무게", f"숫자가 아닙니다: {s}", parent=win); return
                items.append({"nominal": kg, "position": e["pv"].get().strip() or "정중앙"})
            if not items:
                messagebox.showwarning("항목", "항목을 1개 이상 추가하세요.", parent=win); return
            # 이름 변경 시 기존 파일 정리
            if not is_new and data.get("name") and data["name"] != nm:
                old = os.path.join(PROD_DIR, _safe(data["name"]) + ".json")
                if os.path.exists(old): os.remove(old)
            save_json(PROD_DIR, nm, {"name": nm, "items": items})
            self.prod_cb["values"] = list_names(PROD_DIR)
            self.prod_cb.set(nm); self.load_product()
            win.destroy()

        self._pill(btns, "저장", save, "#2F6FED", "#1E4FB0",
                   font=("Helvetica", 10, "bold"), padx=16, pady=5).pack(side="right")
        self._pill(btns, "취소", win.destroy, "#3a3a40", "#4a4a52",
                   font=("Helvetica", 10, "bold"), padx=12, pady=5).pack(side="right", padx=6)

    # ── 실시간 갱신 ──
    def update(self):
        if self.connected and self.chans:
            try:
                for i, v in enumerate(self.chans):
                    r = v.getVoltageRatio()
                    self.disp[i] += SMOOTH*(r - self.disp[i])
                w, total = to_weights(self.disp)
                self.total_lbl.config(text=f"{total:.2f} kg")
                for i in range(4):
                    cv, bar = self.bars[i]
                    width = cv.winfo_width()
                    frac = max(0.0, min(1.0, w[i]/CH_MAX))
                    cv.coords(bar, 0, 0, width*frac, 20)
                    over = w[i] > CH_MAX*0.8
                    cv.itemconfig(bar, fill="#D85A30" if over else "#7F77DD")
                    self.ch_lbl[i].config(text=f"{w[i]:.2f} kg")
                    self.vv_lbl[i].config(text=f"{self.disp[i]:+.2e}")
            except PhidgetException:
                self._close_chans()
                self.conn_lbl.config(text="● 연결 끊김", fg="#E06A50")
                self.status.config(text="장치 연결이 끊겼습니다. 다시 [연결]하세요.", fg="#E06A50")
        self.root.after(120, self.update)

    # ── 보정 ──
    def tare(self):
        if not self._require_conn(): return
        if not messagebox.askokcancel("영점", "컨베이어 위를 모두 비웠나요?\n확인을 누르면 측정합니다."):
            return
        calib["zero"] = read_avg(self.chans)
        self._save_module()
        self.status.config(text=f"[{self.module['name']}] 영점 설정 완료", fg="#5DCAA5")

    def span(self):
        if not self._require_conn(): return
        kn = simpledialog.askfloat("스팬", "정중앙에 올릴 기준무게(kg):", parent=self.root)
        if kn is None: return
        messagebox.showinfo("스팬", f"{kn}kg 분동을 정중앙에 올린 뒤 확인을 누르세요.")
        raw = read_avg(self.chans)
        ds = sum(raw[i]-calib["zero"][i] for i in range(4))
        if abs(ds) < 1e-9:
            messagebox.showerror("오류", "신호 변화가 너무 작습니다. 영점/배선 확인."); return
        k = kn/ds; calib["scale"] = [k]*4
        self._save_module()
        self.status.config(text=f"[{self.module['name']}] 스팬 완료 (공통 스케일 {k:.4g})", fg="#5DCAA5")

    def corner(self):
        if not self._require_conn(): return
        kn = simpledialog.askfloat("코너 보정", "각 코너에 올릴 기준무게(kg):", parent=self.root)
        if kn is None: return
        ns = list(calib["scale"])
        for i, c in enumerate(CHANNELS):
            if not messagebox.askokcancel("코너 보정",
                    f"{kn}kg 분동을 'ch{c}' 로드셀 바로 위(해당 코너)에 올리고 확인."):
                return
            raw = read_avg(self.chans)
            d = raw[i]-calib["zero"][i]
            if abs(d) < 1e-9:
                messagebox.showwarning("경고", f"ch{c} 변화량이 너무 작습니다. 건너뜀."); continue
            ns[i] = kn/d
        calib["scale"] = ns
        self._save_module()
        self.status.config(text=f"[{self.module['name']}] 코너 보정 완료", fg="#5DCAA5")

    # ── 기록 ──
    def record_item(self, idx):
        if not self._require_conn(): return
        if not self.product: return
        it = self.product["items"][idx]
        nominal, position = it["nominal"], it["position"]
        label = self._item_label(it)
        raw = read_avg(self.chans)
        w, total = to_weights(raw)
        err = total - nominal
        verdict = "PASS" if abs(err) <= TOL_KG else "FAIL"

        wd = self.item_w[idx]
        wd["meas"].config(text=f"{total:.2f}kg", fg="#ffffff")
        wd["err"].config(text=f"{err:+.2f}", fg="#5DCAA5" if abs(err) <= TOL_KG else "#E06A50")
        wd["verd"].config(text=verdict, fg="#5DCAA5" if verdict == "PASS" else "#E06A50")

        row = {"시각": now_str(), "모듈": self.module["name"], "시리얼": self.module["serial"],
               "제품": self.product["name"], "항목": label,
               "기대무게": f"{nominal:g}", "위치": position, "측정무게": f"{total:.2f}",
               "오차": f"{err:+.2f}", "판정": verdict,
               "ch0": f"{w[0]:.2f}", "ch1": f"{w[1]:.2f}",
               "ch2": f"{w[2]:.2f}", "ch3": f"{w[3]:.2f}"}
        new = not os.path.exists(CSV_FILE)
        with open(CSV_FILE, "a", newline="", encoding="utf-8-sig") as f:
            wr = csv.DictWriter(f, fieldnames=list(row.keys()))
            if new: wr.writeheader()
            wr.writerow(row)

        over = max(w) > CH_MAX
        warn = "  ⚠ 셀 정격 초과!" if over else ""
        self.status.config(text=f"기록: {label} → {total:.2f}kg ({verdict}){warn}",
                           fg="#E06A50" if (verdict == "FAIL" or over) else "#5DCAA5")

    def on_close(self):
        self._close_chans()
        self.root.destroy()


def main():
    ensure_dirs()
    seed_default_product()
    root = tk.Tk()
    App(root)
    root.mainloop()


if __name__ == "__main__":
    main()
