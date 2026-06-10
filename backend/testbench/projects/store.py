# Copyright 2026 WATT — Apache-2.0
"""프로젝트 저장소 — builtin(YAML, 읽기전용) + user(JSON, 런타임 CRUD).

DESIGN v0.3 §6.3 / 부속 D §6. 프리셋 개념 없음: origin 플래그 + 복제로 통일.
P1: builtin 로드 중심 (user CRUD는 P2 저작 UI).
"""
from __future__ import annotations

import json
import logging
import re
from pathlib import Path

import yaml

logger = logging.getLogger(__name__)


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9가-힣]+", "_", name.strip().lower()).strip("_")
    return s or "project"


class ProjectStore:
    def __init__(self, config) -> None:
        self.cfg = config
        self.builtin_dir = config.dir / "projects" / "builtin"  # 읽기전용(share)
        self.user_dir = config.user_projects_dir                 # 쓰기(홈)

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
        if not self.user_dir.exists():
            return out
        for f in sorted(self.user_dir.glob("*.json")):
            try:
                out.append(self._unwrap(json.loads(f.read_text(encoding="utf-8")), "user"))
            except Exception as e:
                logger.warning("user 프로젝트 로드 실패 %s: %s", f.name, e)
        return out

    # ── 쓰기 (user 프로젝트만, builtin 읽기전용) ──
    def _is_builtin(self, project_id: str) -> bool:
        return (self.builtin_dir / f"{project_id}.yaml").exists()

    def _write_user(self, project: dict) -> dict:
        project["origin"] = "user"
        path = self.user_dir / f"{project['id']}.json"
        path.write_text(json.dumps(project, ensure_ascii=False, indent=2), encoding="utf-8")
        return project

    def create(self, project: dict) -> dict:
        pid = project.get("id") or _slug(project.get("name", ""))
        # id 충돌 회피
        base, n = pid, 1
        while (self.user_dir / f"{pid}.json").exists() or self._is_builtin(pid):
            n += 1
            pid = f"{base}_{n}"
        project["id"] = pid
        logger.info("프로젝트 생성 %s", pid)
        return self._write_user(project)

    def update(self, project_id: str, project: dict) -> dict | None:
        if self._is_builtin(project_id):
            return None  # builtin 읽기전용
        project["id"] = project_id
        return self._write_user(project)

    def delete(self, project_id: str) -> bool:
        path = self.user_dir / f"{project_id}.json"
        if path.exists():
            path.unlink()
            return True
        return False

    def duplicate(self, project_id: str, new_name: str | None = None) -> dict | None:
        src = self.get(project_id)
        if not src:
            return None
        new = dict(src)
        new_name = new_name or f"{src.get('name', project_id)} 복제"
        new["name"] = new_name
        new["id"] = _slug(new_name)
        new["cloned_from"] = project_id
        return self.create(new)
