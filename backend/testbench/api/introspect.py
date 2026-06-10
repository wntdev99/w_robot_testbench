# Copyright 2026 WATT — Apache-2.0
"""introspect API — 런타임 토픽/서비스 발견 + 메시지 타입 필드 트리 (DESIGN v0.3 §7.1).

위젯 동적폼(부속 D §3.2)의 입력: 사용자가 이름 선택 → 타입 → 필드 트리 → 폼 생성.
카탈로그는 박제하지 않고 매 요청 런타임 발견.
"""
from __future__ import annotations

from fastapi import APIRouter, Request

from rosidl_runtime_py.utilities import get_message

from testbench.api.common import HTTP_BAD_REQUEST, ok, raise_http

router = APIRouter()


@router.get("/api/topics")
async def list_topics(request: Request) -> dict:
    b = request.app.state.bridge
    return ok({"topics": [{"name": n, "types": t} for n, t in b.list_topics().items()]})


@router.get("/api/services")
async def list_services(request: Request) -> dict:
    b = request.app.state.bridge
    return ok({"services": [{"name": n, "types": t} for n, t in b.list_services().items()]})


def _fields(type_str: str, depth: int = 0) -> dict:
    """메시지 타입 → 필드 트리 (중첩 메시지 재귀, 배열 표시)."""
    if depth > 6:
        return {}
    msg = get_message(type_str)
    out: dict = {}
    for fname, ftype in msg.get_fields_and_field_types().items():
        is_array = "sequence" in ftype or ftype.endswith("]") or "[" in ftype
        base = ftype.replace("sequence<", "").rstrip(">")
        base = base.split("[")[0].strip()
        if "/" in base:  # 중첩 메시지
            out[fname] = {"type": ftype, "array": is_array, "fields": _fields(base, depth + 1)}
        else:
            out[fname] = {"type": ftype, "array": is_array}
    return out


@router.get("/api/types/{type_str:path}/fields")
async def type_fields(type_str: str) -> dict:
    try:
        return ok({"type": type_str, "fields": _fields(type_str)})
    except Exception as e:
        raise_http("type_err", f"{type_str}: {e}", HTTP_BAD_REQUEST)
