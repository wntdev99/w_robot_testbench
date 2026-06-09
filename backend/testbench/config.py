"""설정 로더 — config/testbench.yaml + config/profiles/*.yaml + config/subsystems/*.yaml.

YAML 을 그대로 dict 로 읽어 가벼운 dataclass 로 감싼다. 스키마 검증은 최소화하고
런타임에 필요한 접근자만 제공한다 (DESIGN.md §6).
"""
from __future__ import annotations

import logging
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger("testbench.config")

# 레포 루트 = backend/testbench/config.py 기준 2단계 위
REPO_ROOT = Path(__file__).resolve().parents[2]
CONFIG_DIR = Path(os.environ.get("TESTBENCH_CONFIG_DIR", REPO_ROOT / "config"))


def _load_yaml(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    with path.open("r", encoding="utf-8") as fh:
        return yaml.safe_load(fh) or {}


@dataclass
class MachineCfg:
    id: str
    host: str
    role: str
    ssh_user: str | None = None
    ws: str | None = None
    setup: str | None = None

    @property
    def is_remote(self) -> bool:
        return self.role != "server"


@dataclass
class Profile:
    id: str
    label: str
    raw: dict[str, Any]
    persistent: bool = False
    exclusive: bool = False
    category: str | None = None

    @property
    def processes(self) -> list[dict[str, Any]]:
        return self.raw.get("processes", [])


@dataclass
class Subsystem:
    id: str
    label: str
    raw: dict[str, Any]


@dataclass
class Config:
    raw: dict[str, Any]
    machines: dict[str, MachineCfg]
    profiles: dict[str, Profile] = field(default_factory=dict)
    subsystems: dict[str, Subsystem] = field(default_factory=dict)

    # ── 편의 접근자 ──
    @property
    def server(self) -> MachineCfg:
        return self.machines["server"]

    @property
    def controller(self) -> MachineCfg | None:
        return self.machines.get("controller")

    @property
    def zenoh(self) -> dict[str, Any]:
        return self.raw.get("zenoh", {})

    @property
    def server_port(self) -> int:
        return int(self.raw.get("server", {}).get("port", 8080))

    @property
    def server_host(self) -> str:
        return self.raw.get("server", {}).get("host", "0.0.0.0")

    @property
    def streaming(self) -> dict[str, Any]:
        return self.raw.get("streaming", {})


def load_config(config_dir: Path | None = None) -> Config:
    cdir = config_dir or CONFIG_DIR
    raw = _load_yaml(cdir / "testbench.yaml")

    machines: dict[str, MachineCfg] = {}
    for key, m in (raw.get("machines") or {}).items():
        machines[key] = MachineCfg(
            id=m.get("id", key),
            host=m.get("host", ""),
            role=m.get("role", key),
            ssh_user=m.get("ssh_user"),
            ws=m.get("ws"),
            setup=m.get("setup"),
        )

    profiles: dict[str, Profile] = {}
    for path in sorted((cdir / "profiles").glob("*.yaml")):
        doc = _load_yaml(path).get("profile") or {}
        if not doc.get("id"):
            logger.warning("프로파일에 id 없음, 건너뜀: %s", path)
            continue
        profiles[doc["id"]] = Profile(
            id=doc["id"],
            label=doc.get("label", doc["id"]),
            raw=doc,
            persistent=bool(doc.get("persistent", False)),
            exclusive=bool(doc.get("exclusive", False)),
            category=doc.get("category"),
        )

    subsystems: dict[str, Subsystem] = {}
    sdir = cdir / "subsystems"
    if sdir.is_dir():
        for path in sorted(sdir.glob("*.yaml")):
            doc = _load_yaml(path).get("subsystem") or {}
            if not doc.get("id"):
                continue
            subsystems[doc["id"]] = Subsystem(
                id=doc["id"], label=doc.get("label", doc["id"]), raw=doc
            )

    logger.info(
        "설정 로드 완료: machines=%d profiles=%d subsystems=%d (dir=%s)",
        len(machines), len(profiles), len(subsystems), cdir,
    )
    return Config(raw=raw, machines=machines, profiles=profiles, subsystems=subsystems)
