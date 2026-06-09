"""런치 파일 런타임 발견 — ament share 의 *.launch.* 스캔.

서버(로컬)는 AMENT_PREFIX_PATH 의 share/<pkg>/launch 를 스캔.
컨트롤러(201)는 RemoteRunner 로 SSH find.
"""
from __future__ import annotations

import glob
import os

_EXTS = (".launch.py", ".launch.xml", ".launch.yaml", ".launch.yml")


def _pkg_from_path(path: str) -> str:
    if "/share/" in path:
        return path.split("/share/", 1)[1].split("/", 1)[0]
    return ""


def scan_local_launch_files() -> list[dict]:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    prefixes = [p for p in os.environ.get("AMENT_PREFIX_PATH", "").split(":") if p]
    for prefix in prefixes:
        for path in glob.glob(f"{prefix}/share/*/launch/**/*", recursive=True):
            if not path.endswith(_EXTS):
                continue
            pkg = _pkg_from_path(path)
            fname = os.path.basename(path)
            key = (pkg, fname)
            if key in seen:
                continue
            seen.add(key)
            out.append({"package": pkg, "file": fname, "path": path})
    return sorted(out, key=lambda x: (x["package"], x["file"]))


def parse_remote_find(stdout: str) -> list[dict]:
    seen: set[tuple[str, str]] = set()
    out: list[dict] = []
    for line in (stdout or "").splitlines():
        path = line.strip()
        if not path.endswith(_EXTS):
            continue
        pkg = _pkg_from_path(path)
        fname = os.path.basename(path)
        key = (pkg, fname)
        if key in seen:
            continue
        seen.add(key)
        out.append({"package": pkg, "file": fname, "path": path})
    return sorted(out, key=lambda x: (x["package"], x["file"]))
