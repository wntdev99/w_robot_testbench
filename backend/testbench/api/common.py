# Copyright 2026 WATT — Apache-2.0
"""공통 API 헬퍼 — 응답 엔벨로프 (bt_web_bridge 계승)."""
from __future__ import annotations

from typing import Any

from fastapi import HTTPException, status


def ok(data: Any) -> dict:
    return {"ok": True, "data": data}


def err(code: str, message: str, details: Any | None = None) -> dict:
    payload: dict = {"ok": False, "error": {"code": code, "message": message}}
    if details is not None:
        payload["error"]["details"] = details
    return payload


def raise_http(code: str, message: str, http_status: int, details: Any | None = None) -> None:
    raise HTTPException(
        status_code=http_status, detail=err(code, message, details)["error"],
    )


HTTP_NOT_FOUND = status.HTTP_404_NOT_FOUND
HTTP_BAD_REQUEST = status.HTTP_400_BAD_REQUEST
HTTP_CONFLICT = status.HTTP_409_CONFLICT
HTTP_INTERNAL = status.HTTP_500_INTERNAL_SERVER_ERROR
