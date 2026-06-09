"""로컬(서버=202) 시스템 통계 — CPU/메모리/온도/네트워크/인터넷.

psutil + /sys/class/thermal. DESIGN.md §4.1 L0 모니터.
"""
from __future__ import annotations

import asyncio
import re
import time

import psutil

_RTT_RE = re.compile(r"time[=<]([\d.]+)\s*ms")

_last_net: tuple[float, int, int] | None = None


def cpu_percent() -> float:
    return psutil.cpu_percent(interval=None)


def mem() -> dict:
    m = psutil.virtual_memory()
    return {"total": m.total, "used": m.used, "percent": m.percent}


def temperatures() -> dict[str, float]:
    out: dict[str, float] = {}
    try:
        for name, entries in (psutil.sensors_temperatures() or {}).items():
            for e in entries:
                label = e.label or name
                out[f"{name}:{label}" if e.label else name] = round(e.current, 1)
    except Exception:  # noqa: BLE001
        pass
    return out


def net_rate() -> dict:
    """누적 송수신 바이트 → 호출 간 평균 바이트/초."""
    global _last_net
    now = time.time()
    io = psutil.net_io_counters()
    rate = {"tx_bps": 0.0, "rx_bps": 0.0}
    if _last_net is not None:
        dt = now - _last_net[0]
        if dt > 0:
            rate["tx_bps"] = (io.bytes_sent - _last_net[1]) / dt
            rate["rx_bps"] = (io.bytes_recv - _last_net[2]) / dt
    _last_net = (now, io.bytes_sent, io.bytes_recv)
    return rate


async def ping_rtt(host: str, timeout: float = 2.0) -> tuple[bool, float | None]:
    """ping 1회 → (성공여부, RTT[ms] | None)."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ping", "-c", "1", "-W", str(int(timeout)), host,
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        if proc.returncode != 0:
            return False, None
        m = _RTT_RE.search(out.decode(errors="ignore"))
        return True, (float(m.group(1)) if m else None)
    except Exception:  # noqa: BLE001
        return False, None


async def snapshot(controller_reachable: bool | None = None,
                   controller_host: str | None = None) -> dict:
    inet_ok, inet_ms = await ping_rtt("8.8.8.8")
    latency: dict[str, float | None] = {"internet_ms": inet_ms}
    if controller_host:
        _, ctrl_ms = await ping_rtt(controller_host)
        latency["controller_ms"] = ctrl_ms
    return {
        "cpu_percent": cpu_percent(),
        "mem": mem(),
        "temperatures": temperatures(),
        "net": net_rate(),                 # 처리량(bytes/s)
        "latency": latency,                # 지연(ms) — internet_ms / controller_ms
        "internet": inet_ok,
        "controller_reachable": controller_reachable,
        "ts": time.time(),
    }
