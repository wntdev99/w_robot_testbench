# Copyright 2026 WATT — Apache-2.0
"""설정 로더 — config/testbench.yaml + baseline.yaml (DESIGN v0.3 §6).

런타임 동적 발견 원칙: 토픽/노드 카탈로그는 박제하지 않는다. 여기 담는 건
서버/머신/zenoh/boot_gate/baseline 같은 '구조적 설정'만.
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

import yaml

logger = logging.getLogger(__name__)


def _repo_root() -> Path:
    # backend/testbench/config.py → repo root
    return Path(__file__).resolve().parents[2]


def _config_dir() -> Path:
    # 설치 환경: ament share/<pkg>/config 우선. 없으면 소스 레포 config (개발).
    try:
        from ament_index_python.packages import get_package_share_directory

        share = Path(get_package_share_directory("w_robot_testbench")) / "config"
        if share.exists():
            return share
    except Exception:
        pass
    return _repo_root() / "config"


def load_yaml(path: Path) -> dict[str, Any]:
    if not path.exists():
        logger.warning("config 파일 없음: %s", path)
        return {}
    with path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


class Config:
    """testbench.yaml + baseline.yaml 을 묶어 읽는 설정 객체."""

    def __init__(self, config_dir: Path | None = None) -> None:
        self.dir = config_dir or _config_dir()
        self.testbench: dict[str, Any] = {}
        self.baseline: list[dict[str, Any]] = []
        self.reload()

    def reload(self) -> None:
        self.testbench = load_yaml(self.dir / "testbench.yaml")
        self.baseline = load_yaml(self.dir / "baseline.yaml").get("baseline", []) or []
        logger.info(
            "config 로드: server=%s baseline=%d개 대상",
            self.server, len(self.baseline),
        )

    # ── 편의 접근자 ──
    @property
    def server(self) -> dict[str, Any]:
        return self.testbench.get("server", {"host": "0.0.0.0", "port": 8080})

    @property
    def machines(self) -> dict[str, Any]:
        return self.testbench.get("machines", {})

    @property
    def zenoh(self) -> dict[str, Any]:
        return self.testbench.get("zenoh", {})

    @property
    def boot_gate(self) -> dict[str, Any]:
        return self.testbench.get("boot_gate", {})

    @property
    def ros_proc_patterns(self) -> list[str]:
        return self.boot_gate.get("ros_proc_patterns", [])
