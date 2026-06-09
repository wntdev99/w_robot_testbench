"""UI 구성 스냅샷 저장소 — config/snapshots/*.json.

워크스페이스 패널 구성(레이아웃)을 이름으로 저장/복원/삭제 (DESIGN.md §6 스냅샷).
"""
from __future__ import annotations

import json
import re
import time
from pathlib import Path

from .config import CONFIG_DIR

SNAP_DIR = CONFIG_DIR / "snapshots"


def _safe(name: str) -> str:
    # 경로 분리자/상위경로 제거, 파일명 안전화 (한글/영숫자/공백/-/_ 허용)
    cleaned = re.sub(r"[^\w \-가-힣]", "_", name).strip()
    return cleaned or "snapshot"


def _path(name: str) -> Path:
    return SNAP_DIR / f"{_safe(name)}.json"


def list_snapshots() -> list[dict]:
    if not SNAP_DIR.is_dir():
        return []
    out = []
    for p in sorted(SNAP_DIR.glob("*.json")):
        try:
            doc = json.loads(p.read_text(encoding="utf-8"))
            out.append({"name": doc.get("name", p.stem), "updated": doc.get("updated")})
        except Exception:  # noqa: BLE001
            continue
    return out


def save_snapshot(name: str, data: dict) -> dict:
    SNAP_DIR.mkdir(parents=True, exist_ok=True)
    doc = {"name": name, "updated": time.time(), "data": data}
    _path(name).write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    return {"name": name, "updated": doc["updated"]}


def load_snapshot(name: str) -> dict | None:
    p = _path(name)
    if not p.is_file():
        return None
    return json.loads(p.read_text(encoding="utf-8"))


def delete_snapshot(name: str) -> bool:
    p = _path(name)
    if p.is_file():
        p.unlink()
        return True
    return False
