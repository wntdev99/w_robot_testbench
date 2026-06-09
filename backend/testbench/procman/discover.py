"""런치 파일 런타임 발견 — ament share 의 *.launch.* 스캔.

서버(로컬)는 AMENT_PREFIX_PATH 의 share/<pkg>/launch 를 스캔.
컨트롤러(201)는 RemoteRunner 로 SSH find.
"""
from __future__ import annotations

import glob
import os

import psutil

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


def _launch_from_tokens(toks: list[str]) -> dict | None:
    """['...ros2','launch','pkg','file', ...] → {package, file}. 'launch'는 ros2 verb 여야."""
    if "launch" not in toks:
        return None
    i = toks.index("launch")
    if i == 0:
        return None
    prev = toks[i - 1]
    if not (prev == "ros2" or prev.endswith("/ros2")):
        return None
    pkg = toks[i + 1] if i + 1 < len(toks) else ""
    fil = toks[i + 2] if i + 2 < len(toks) else ""
    if fil.startswith("-"):
        fil = ""
    return {"package": pkg, "file": fil}


def scan_running_launches() -> list[dict]:
    """로컬에서 실제 실행 중인 ros2 launch 프로세스 스캔."""
    out: list[dict] = []
    for p in psutil.process_iter(["pid", "cmdline"]):
        try:
            cmd = p.info.get("cmdline") or []
        except (psutil.NoSuchProcess, psutil.AccessDenied):
            continue
        info = _launch_from_tokens(cmd)
        if info:
            out.append({"pid": p.info["pid"], **info})
    return out


def parse_remote_ps(stdout: str) -> list[dict]:
    """원격 `ps -eo pid=,args=` 출력에서 ros2 launch 추출."""
    out: list[dict] = []
    for line in (stdout or "").splitlines():
        line = line.strip()
        if not line or "launch" not in line:
            continue
        parts = line.split()
        pid = None
        toks = parts
        if parts and parts[0].isdigit():
            pid = int(parts[0])
            toks = parts[1:]
        info = _launch_from_tokens(toks)
        if info:
            out.append({"pid": pid, **info})
    return out


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
