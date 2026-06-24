#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
로드셀 4채널 무게 측정 테스트 하네스
- 장비: PhidgetBridge 4-Input (1046), S/N 804808, 채널 0~3, 게인 128x
- 기능: 실시간 표시 / 영점(Tare) / 스팬 캘리브레이션 / 코너 보정 / CSV 기록
- 측정 모델:  채널별 무게  wᵢ = (rᵢ − zeroᵢ) × scaleᵢ,   총무게 = Σ wᵢ

사전 준비:
    pip3 install Phidget22 --break-system-packages
    (Phidget22 라이브러리는 Phidget22.dmg 설치로 이미 깔려 있어야 함)
    측정 코드 실행 전 Phidget Control Panel 은 반드시 닫을 것 (안 그러면 device in use 에러)
"""

import json
import csv
import os
import sys
import time
from datetime import datetime

try:
    from Phidget22.Devices.VoltageRatioInput import VoltageRatioInput
    from Phidget22.BridgeGain import BridgeGain
    from Phidget22.PhidgetException import PhidgetException
except ImportError:
    print("[오류] Phidget22 모듈이 없습니다.  먼저 설치하세요:")
    print("       pip3 install Phidget22 --break-system-packages")
    sys.exit(1)

# ───────────────────────── 설정 ─────────────────────────
SERIAL        = 804808          # 보드 시리얼 (USB에서 확인된 값)
CHANNELS      = [0, 1, 2, 3]    # 로드셀 4개가 꽂힌 채널
GAIN          = BridgeGain.BRIDGE_GAIN_128   # 128x
DATA_INTERVAL = 128             # ms (8의 배수)
CAL_FILE      = "calibration.json"
CSV_FILE      = "measurements.csv"

# 캘리브레이션 기본값 (보정 전: 영점 0, 스케일 1)
calib = {
    "zero":  [0.0, 0.0, 0.0, 0.0],   # 채널별 영점 (무부하 시 V/V)
    "scale": [1.0, 1.0, 1.0, 1.0],   # 채널별 기울기 (V/V → kg)
}


# ───────────────────────── 장치 연결 ─────────────────────────
def connect():
    chans = []
    for c in CHANNELS:
        v = VoltageRatioInput()
        v.setDeviceSerialNumber(SERIAL)
        v.setChannel(c)
        v.openWaitForAttachment(5000)   # 5초 대기
        v.setBridgeGain(GAIN)
        try:
            v.setDataInterval(DATA_INTERVAL)
        except PhidgetException:
            v.setDataInterval(v.getMinDataInterval())
        chans.append(v)
    time.sleep(0.5)  # 첫 데이터 안정화
    print(f"[연결됨] 채널 {CHANNELS}  (게인 128x, 간격 {DATA_INTERVAL}ms)\n")
    return chans


def close(chans):
    for v in chans:
        try:
            v.close()
        except PhidgetException:
            pass


# ───────────────────────── 읽기 ─────────────────────────
def read_raw(chans, samples=12, interval=0.13):
    """각 채널의 V/V 값을 samples 회 평균하여 [r0,r1,r2,r3] 반환"""
    acc = [0.0] * len(chans)
    for _ in range(samples):
        for i, v in enumerate(chans):
            acc[i] += v.getVoltageRatio()
        time.sleep(interval)
    return [a / samples for a in acc]


def to_weights(raw):
    """원시 V/V → 채널별 kg, 총 kg"""
    w = [(raw[i] - calib["zero"][i]) * calib["scale"][i] for i in range(len(raw))]
    return w, sum(w)


# ───────────────────────── 캘리브레이션 저장/로드 ─────────────────────────
def load_calib():
    global calib
    if os.path.exists(CAL_FILE):
        with open(CAL_FILE, "r") as f:
            calib = json.load(f)
        print(f"[캘리브레이션 불러옴] {CAL_FILE}")
    else:
        print("[안내] 저장된 캘리브레이션이 없습니다. 영점→스팬(또는 코너보정)을 먼저 하세요.")


def save_calib():
    with open(CAL_FILE, "w") as f:
        json.dump(calib, f, indent=2)
    print(f"[저장됨] {CAL_FILE}")


# ───────────────────────── 기능들 ─────────────────────────
def do_live(chans):
    print("\n실시간 측정 (Ctrl+C 로 메뉴 복귀)\n")
    try:
        while True:
            raw = read_raw(chans, samples=4, interval=0.06)
            w, total = to_weights(raw)
            rs = "  ".join(f"ch{CHANNELS[i]}:{raw[i]:+.3e}" for i in range(len(raw)))
            ws = "  ".join(f"{w[i]:+6.2f}" for i in range(len(w)))
            print(f"\r{rs}  |  kg[{ws}]  |  합계 {total:7.2f} kg   ", end="", flush=True)
    except KeyboardInterrupt:
        print("\n")


def do_tare(chans):
    print("\n[영점] 컨베이어 위를 모두 비우세요. Enter 누르면 측정...")
    input()
    raw = read_raw(chans, samples=20)
    calib["zero"] = raw
    for i in range(len(raw)):
        print(f"  ch{CHANNELS[i]} 영점 = {raw[i]:+.4e} V/V")
    save_calib()
    print("[완료] 영점 설정됨\n")


def do_span_center(chans):
    """정중앙 스팬: 공통 스케일 1개를 4채널에 적용"""
    try:
        known = float(input("\n[스팬] 정중앙에 올릴 기준무게(kg) 입력: ").strip())
    except ValueError:
        print("숫자를 입력하세요.\n"); return
    print(f"  {known}kg 분동을 컨베이어 정중앙에 올린 뒤 Enter...")
    input()
    raw = read_raw(chans, samples=20)
    delta_sum = sum(raw[i] - calib["zero"][i] for i in range(len(raw)))
    if abs(delta_sum) < 1e-9:
        print("[오류] 신호 변화가 너무 작습니다. 영점/배선 확인.\n"); return
    k = known / delta_sum
    calib["scale"] = [k, k, k, k]
    save_calib()
    print(f"[완료] 공통 스케일 = {k:.4g}  (4채널 동일 적용)\n")
    print("  ※ 쏠림 정확도가 필요하면 '코너 보정'을 추가로 하세요.\n")


def do_corner(chans):
    """코너 보정: 같은 분동을 각 코너에 올려 채널별 스케일 산출"""
    try:
        known = float(input("\n[코너 보정] 각 코너에 올릴 기준무게(kg) 입력: ").strip())
    except ValueError:
        print("숫자를 입력하세요.\n"); return
    new_scale = list(calib["scale"])
    for i, c in enumerate(CHANNELS):
        print(f"\n  → {known}kg 분동을 '채널 {c}' 로드셀 바로 위(해당 코너)에 올리고 Enter...")
        input()
        raw = read_raw(chans, samples=20)
        delta = raw[i] - calib["zero"][i]   # 해당 코너 채널의 변화량
        if abs(delta) < 1e-9:
            print(f"  [경고] ch{c} 변화량이 너무 작습니다. 위치/배선 확인. 건너뜀.")
            continue
        new_scale[i] = known / delta
        print(f"  ch{c} 스케일 = {new_scale[i]:.4g}")
    calib["scale"] = new_scale
    save_calib()
    print("\n[완료] 코너 보정됨. 이제 어느 위치에 올려도 합계가 실제무게에 가깝게 나와야 합니다.\n")
    print("  검증: 같은 분동을 중앙/각 코너에 올려보고 합계가 ±0.5kg 안에서 일치하는지 확인하세요.\n")


def do_record(chans):
    """측정값을 CSV로 기록 (테스트 표 채우기용)"""
    nominal = input("\n[기록] 기대무게(kg, 예: 30): ").strip()
    position = input("적재 위치 (1=정중앙, 2=쏠림): ").strip()
    position = "정중앙" if position == "1" else "쏠림"
    print("  물체를 올리고 값이 안정되면 Enter...")
    input()
    raw = read_raw(chans, samples=20)
    w, total = to_weights(raw)
    try:
        err = total - float(nominal)
        err_s = f"{err:+.2f}"
        verdict = "PASS" if abs(err) <= 0.5 else "FAIL"
    except ValueError:
        err_s, verdict = "", ""
    row = {
        "시각": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "기대무게": nominal, "위치": position,
        "측정무게": f"{total:.2f}", "오차": err_s, "판정": verdict,
        "ch0": f"{w[0]:.2f}", "ch1": f"{w[1]:.2f}",
        "ch2": f"{w[2]:.2f}", "ch3": f"{w[3]:.2f}",
    }
    new_file = not os.path.exists(CSV_FILE)
    with open(CSV_FILE, "a", newline="", encoding="utf-8-sig") as f:
        wr = csv.DictWriter(f, fieldnames=list(row.keys()))
        if new_file:
            wr.writeheader()
        wr.writerow(row)
    print(f"  → 측정 {total:.2f} kg  (오차 {err_s}, {verdict})  / {CSV_FILE} 에 기록됨\n")


# ───────────────────────── 메뉴 ─────────────────────────
MENU = """
══════════ 로드셀 테스트 ══════════
 1) 실시간 측정 보기
 2) 영점(Tare) 잡기
 3) 스팬 캘리브레이션 (정중앙)
 4) 코너 보정 (쏠림 정확도)
 5) 측정값 기록 (CSV)
 6) 현재 캘리브레이션 보기
 0) 종료
───────────────────────────────────
선택: """


def main():
    load_calib()
    chans = connect()
    try:
        while True:
            choice = input(MENU).strip()
            if choice == "1": do_live(chans)
            elif choice == "2": do_tare(chans)
            elif choice == "3": do_span_center(chans)
            elif choice == "4": do_corner(chans)
            elif choice == "5": do_record(chans)
            elif choice == "6":
                print("\n  zero :", [f"{z:+.3e}" for z in calib["zero"]])
                print("  scale:", [f"{s:.4g}" for s in calib["scale"]], "\n")
            elif choice == "0":
                break
            else:
                print("0~6 중에서 선택하세요.")
    except KeyboardInterrupt:
        pass
    finally:
        close(chans)
        print("\n장치 닫음. 종료합니다.")


if __name__ == "__main__":
    main()
