"""녹화 — 백엔드 풀레이트 기록 → 정지 시 Wide CSV 한 번에 기록.

설계(DESIGN.md §6 자산화):
- 토픽/diagnostics/system 데이터를 세션 단위로 기록.
- 녹화 중에는 행(dict)을 메모리에 적재(샘플 1건당 1행), 정지 시 전체 열 합집합으로
  Wide CSV 를 기록(리샘플 손실 0, 비동기 다중 토픽/배열 필드 헤더 문제 회피).
- 토픽은 ros_bridge 다중구독(sid=세션id)으로 풀레이트 수신(플롯과 공존).
"""
from __future__ import annotations

import csv
import json
import logging
import threading
import time
from pathlib import Path

from .config import REPO_ROOT
from .ros_bridge import RosBridge

logger = logging.getLogger("testbench.recorder")

REC_DIR = Path(REPO_ROOT) / "recordings"
_NUMERIC_TYPES = (int, float, bool)


def _flatten_numeric(obj, prefix: str, out: dict) -> None:
    if isinstance(obj, dict):
        for k, v in obj.items():
            if k == "header":
                continue
            _flatten_numeric(v, f"{prefix}.{k}" if prefix else k, out)
    elif isinstance(obj, (list, tuple)):
        for i, v in enumerate(obj):
            _flatten_numeric(v, f"{prefix}[{i}]", out)
    elif isinstance(obj, bool):
        out[prefix] = 1 if obj else 0
    elif isinstance(obj, (int, float)):
        out[prefix] = obj


class _Session:
    def __init__(self, sid: str, name: str, topics: list[dict], diagnostics: bool, system: bool):
        self.id = sid
        self.name = name
        self.topics = topics
        self.diagnostics = diagnostics
        self.system = system
        self.rows: list[dict] = []
        self.started = time.time()
        self.lock = threading.Lock()

    def add(self, row: dict) -> None:
        with self.lock:
            self.rows.append(row)


class Recorder:
    def __init__(self, ros: RosBridge) -> None:
        self._ros = ros
        self._sessions: dict[str, _Session] = {}
        self._seq = 0

    # ── 세션 시작 ──
    def start(self, name: str, topics: list[dict], diagnostics: bool, system: bool) -> dict:
        self._seq += 1
        sid = f"rec{self._seq}"
        label = name.strip() or sid
        sess = _Session(sid, label, topics, diagnostics, system)
        self._sessions[sid] = sess

        for t in topics:
            topic = t.get("topic")
            if not topic:
                continue
            self._ros.subscribe(
                topic, t.get("msgType"),
                lambda data, _tp=topic, _s=sess: self._on_topic(_s, _tp, data),
                sid=sid,
            )
        if diagnostics:
            self._ros.set_diagnostics_callback(
                lambda upd, _s=sess: self._on_diag(_s, upd), sid=sid)
        logger.info("녹화 시작 [%s] '%s' topics=%d diag=%s sys=%s",
                    sid, label, len(topics), diagnostics, system)
        return self.status(sid)

    def _on_topic(self, sess: _Session, topic: str, data: dict) -> None:
        flat: dict = {}
        _flatten_numeric(data, "", flat)
        if not flat:
            return
        row = {"time": time.time()}
        for k, v in flat.items():
            row[f"{topic}/{k}"] = v
        sess.add(row)

    def _on_diag(self, sess: _Session, updated: dict) -> None:
        row = {"time": time.time()}
        for hid, fields in updated.items():
            for k, v in fields.items():
                if k.startswith("_"):
                    continue
                try:
                    row[f"{hid}/{k}"] = float(v)
                except (TypeError, ValueError):
                    continue
        if len(row) > 1:
            sess.add(row)

    def on_system(self, stats: dict) -> None:
        """main 모니터 루프가 매 시스템 스냅샷마다 호출."""
        active = [s for s in self._sessions.values() if s.system]
        if not active:
            return
        flat: dict = {}
        _flatten_numeric({k: v for k, v in stats.items() if k != "ts"}, "system", flat)
        for s in active:
            row = {"time": stats.get("ts", time.time()), **flat}
            s.add(row)

    # ── 세션 정지 → Wide CSV ──
    def stop(self, sid: str) -> dict:
        sess = self._sessions.pop(sid, None)
        if not sess:
            return {"ok": False, "reason": "unknown session"}
        for t in sess.topics:
            if t.get("topic"):
                self._ros.unsubscribe(t["topic"], sid=sid)
        if sess.diagnostics:
            self._ros.remove_diagnostics_callback(sid=sid)

        with sess.lock:
            rows = list(sess.rows)
        REC_DIR.mkdir(parents=True, exist_ok=True)
        stamp = time.strftime("%Y%m%d_%H%M%S", time.localtime(sess.started))
        safe = "".join(c if c.isalnum() or c in " -_가-힣" else "_" for c in sess.name).strip() or sid
        base = f"{stamp}_{safe}"
        csv_path = REC_DIR / f"{base}.csv"

        cols: list[str] = []
        seen = set()
        for r in rows:
            for k in r:
                if k != "time" and k not in seen:
                    seen.add(k); cols.append(k)
        cols.sort()
        header = ["time"] + cols
        with csv_path.open("w", newline="", encoding="utf-8") as fh:
            w = csv.writer(fh)
            w.writerow(header)
            for r in rows:
                w.writerow([r.get("time")] + [r.get(c, "") for c in cols])

        meta = {
            "name": sess.name, "started": sess.started, "stopped": time.time(),
            "rows": len(rows), "columns": cols,
            "topics": [t.get("topic") for t in sess.topics],
            "diagnostics": sess.diagnostics, "system": sess.system,
        }
        (REC_DIR / f"{base}.meta.json").write_text(
            json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        logger.info("녹화 정지 [%s] → %s (%d행 %d열)", sid, csv_path.name, len(rows), len(cols))
        return {"ok": True, "file": csv_path.name, "rows": len(rows), "columns": len(cols)}

    # ── 조회 ──
    def status(self, sid: str) -> dict:
        s = self._sessions.get(sid)
        if not s:
            return {"id": sid, "active": False}
        with s.lock:
            n = len(s.rows)
        return {"id": sid, "name": s.name, "active": True, "rows": n,
                "elapsed_s": time.time() - s.started}

    def active(self) -> list[dict]:
        return [self.status(sid) for sid in list(self._sessions.keys())]

    def list_recordings(self) -> list[dict]:
        if not REC_DIR.is_dir():
            return []
        out = []
        for p in sorted(REC_DIR.glob("*.csv"), reverse=True):
            meta_p = p.with_suffix("").with_suffix(".meta.json")
            meta = {}
            if meta_p.is_file():
                try:
                    meta = json.loads(meta_p.read_text(encoding="utf-8"))
                except Exception:  # noqa: BLE001
                    pass
            out.append({"file": p.name, "size": p.stat().st_size,
                        "rows": meta.get("rows"), "name": meta.get("name")})
        return out

    def stop_all(self) -> None:
        for sid in list(self._sessions.keys()):
            self.stop(sid)
