# Copyright 2026 WATT — Apache-2.0
"""Recorder — 실행(run) 단위 토픽 CSV 기록 + 카운터 + 수동 verdict (L6).

run 디렉터리: ~/.w_robot_testbench/records/<run_id>/
  - <topic>.csv  : stamp,json(flatten 없이 json 1열 — 타입 불문 안전)
  - meta.json    : project_id·시각·counters·verdict(PASS/FAIL/코멘트, 수동)
합/불은 자동 판정하지 않는다(human-in-the-loop, 부속 D §6-7).
"""
from __future__ import annotations

import csv
import json
import logging
import time
from datetime import datetime
from pathlib import Path

from rosidl_runtime_py.convert import message_to_ordereddict
from rosidl_runtime_py.utilities import get_message

logger = logging.getLogger(__name__)


def records_root() -> Path:
    d = Path.home() / ".w_robot_testbench" / "records"
    d.mkdir(parents=True, exist_ok=True)
    return d


class Recorder:
    """한 번에 한 run 기록 (exclusive 정책과 일치)."""

    def __init__(self, node) -> None:
        self.node = node
        self.run_id: str | None = None
        self.run_dir: Path | None = None
        self.meta: dict = {}
        self._subs: list = []
        self._files: dict[str, tuple] = {}  # topic -> (fh, writer)

    @property
    def active(self) -> bool:
        return self.run_id is not None

    def start(self, project_id: str, topics: list[str]) -> dict:
        if self.active:
            return {"error": "already_recording", "run_id": self.run_id}
        self.run_id = f"{project_id}_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
        self.run_dir = records_root() / self.run_id
        self.run_dir.mkdir(parents=True, exist_ok=True)
        self.meta = {"run_id": self.run_id, "project_id": project_id,
                     "started_at": datetime.now().astimezone().isoformat(),
                     "topics": topics, "counters": {}, "verdict": None}
        subscribed = []
        for t in topics:
            types = dict(self.node.get_topic_names_and_types()).get(t)
            if not types:
                continue
            try:
                msg_type = get_message(types[0])
            except Exception:
                continue
            fh = (self.run_dir / (t.strip("/").replace("/", "__") + ".csv")).open("w", newline="")
            w = csv.writer(fh)
            w.writerow(["stamp", "json"])
            self._files[t] = (fh, w)
            self._subs.append(self.node.create_subscription(
                msg_type, t, lambda m, tt=t: self._cb(tt, m), 10))
            subscribed.append(t)
        self._save_meta()
        logger.info("record start %s topics=%s", self.run_id, subscribed)
        return {"run_id": self.run_id, "recording": subscribed}

    def _cb(self, topic: str, msg) -> None:
        ent = self._files.get(topic)
        if not ent:
            return
        try:
            ent[1].writerow([time.time(), json.dumps(message_to_ordereddict(msg), default=str)])
        except Exception:
            pass

    def set_counter(self, key: str, value) -> None:
        self.meta.setdefault("counters", {})[key] = value
        self._save_meta()

    def stop(self) -> dict:
        if not self.active:
            return {"error": "not_recording"}
        for s in self._subs:
            self.node.destroy_subscription(s)
        self._subs.clear()
        for fh, _ in self._files.values():
            fh.close()
        self._files.clear()
        self.meta["stopped_at"] = datetime.now().astimezone().isoformat()
        self._save_meta()
        rid = self.run_id
        self.run_id = None
        return {"run_id": rid, "stopped": True}

    def set_verdict(self, run_id: str, verdict: str, comment: str = "") -> dict | None:
        """수동 합/불 — 실행 중이든 종료 후든 meta.json에 박제."""
        d = records_root() / run_id / "meta.json"
        if not d.exists():
            return None
        meta = json.loads(d.read_text(encoding="utf-8"))
        meta["verdict"] = {"result": verdict, "comment": comment,
                           "at": datetime.now().astimezone().isoformat()}
        d.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")
        return meta

    def _save_meta(self) -> None:
        if self.run_dir:
            (self.run_dir / "meta.json").write_text(
                json.dumps(self.meta, ensure_ascii=False, indent=2), encoding="utf-8")

    @staticmethod
    def list_runs() -> list[dict]:
        out = []
        for d in sorted(records_root().iterdir(), reverse=True):
            m = d / "meta.json"
            if m.exists():
                try:
                    out.append(json.loads(m.read_text(encoding="utf-8")))
                except Exception:
                    pass
        return out
