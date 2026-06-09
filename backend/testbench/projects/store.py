# Copyright 2026 WATT — Apache-2.0
"""프로젝트 저장소 — builtin(YAML, 읽기전용) + user(JSON, 런타임 CRUD).

DESIGN v0.3 §6.3 / 부속 D §6. 프리셋 개념 없음: origin 플래그 + 복제로 통일.
P1: builtin 로드 중심 (user CRUD는 P2 저작 UI).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


class ProjectStore:
    def __init__(self, config) -> None:
        self.cfg = config
        self.projects_dir = config.dir / "projects"
        self.builtin_dir = self.projects_dir / "builtin"

    def _unwrap(self, raw: dict, origin: str) -> dict:
        tp = raw.get("test_project", raw) if isinstance(raw, dict) else {}
        tp["origin"] = origin
        return tp

    def list(self) -> list[dict]:
        return self._list_builtin() + self._list_user()

    def get(self, project_id: str) -> dict | None:
        for p in self.list():
            if p.get("id") == project_id:
                return p
        return None

    def _list_builtin(self) -> list[dict]:
        out: list[dict] = []
        if not self.builtin_dir.exists():
            return out
        for f in sorted(self.builtin_dir.glob("*.yaml")):
            try:
                out.append(self._unwrap(yaml.safe_load(f.read_text(encoding="utf-8")), "builtin"))
            except Exception as e:
                logger.warning("builtin 프로젝트 로드 실패 %s: %s", f.name, e)
        return out

    def _list_user(self) -> list[dict]:
        out: list[dict] = []
        if not self.projects_dir.exists():
            return out
        for f in sorted(self.projects_dir.glob("*.json")):
            try:
                out.append(self._unwrap(json.loads(f.read_text(encoding="utf-8")), "user"))
            except Exception as e:
                logger.warning("user 프로젝트 로드 실패 %s: %s", f.name, e)
        return out
