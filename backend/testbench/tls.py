"""자체서명 TLS 인증서 — 없으면 openssl 로 생성 (게임패드 등 secure-context API용).

certs/cert.pem, certs/key.pem (gitignored). SAN 에 서버 IP + localhost 포함.
"""
from __future__ import annotations

import ipaddress
import logging
import subprocess
from pathlib import Path

from .config import REPO_ROOT

logger = logging.getLogger("testbench.tls")

CERT_DIR = REPO_ROOT / "certs"
CERT = CERT_DIR / "cert.pem"
KEY = CERT_DIR / "key.pem"


def _is_ip(h: str) -> bool:
    try:
        ipaddress.ip_address(h)
        return True
    except ValueError:
        return False


def ensure_self_signed(hosts: list[str]) -> tuple[str, str] | None:
    """인증서가 없으면 생성하고 (cert, key) 경로 반환. 실패 시 None."""
    if CERT.is_file() and KEY.is_file():
        return str(CERT), str(KEY)
    CERT_DIR.mkdir(parents=True, exist_ok=True)
    uniq = []
    for h in [*hosts, "localhost", "127.0.0.1"]:
        if h and h not in uniq:
            uniq.append(h)
    san = "subjectAltName=" + ",".join(f"IP:{h}" if _is_ip(h) else f"DNS:{h}" for h in uniq)
    try:
        subprocess.run(
            ["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes",
             "-keyout", str(KEY), "-out", str(CERT), "-days", "3650",
             "-subj", "/CN=w_robot_testbench", "-addext", san],
            check=True, capture_output=True,
        )
        logger.info("자체서명 인증서 생성: %s (SAN: %s)", CERT, san)
        return str(CERT), str(KEY)
    except Exception as exc:  # noqa: BLE001
        logger.error("인증서 생성 실패(openssl?): %s", exc)
        return None
