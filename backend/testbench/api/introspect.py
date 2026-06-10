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


def _fields_of_type(msg_type, depth: int = 0) -> dict:
    """필드 트리 (중첩 재귀·배열). msg 타입 객체 또는 srv Request 둘 다 받음."""
    if depth > 6:
        return {}
    out: dict = {}
    for fname, ftype in msg_type.get_fields_and_field_types().items():
        is_array = "sequence" in ftype or ftype.endswith("]") or "[" in ftype
        base = ftype.replace("sequence<", "").rstrip(">").split("[")[0].strip()
        if "/" in base:  # 중첩 메시지
            out[fname] = {"type": ftype, "array": is_array, "fields": _fields_of_type(get_message(base), depth + 1)}
        else:
            out[fname] = {"type": ftype, "array": is_array}
    return out


def _fields(type_str: str, depth: int = 0) -> dict:
    return _fields_of_type(get_message(type_str), depth)


@router.get("/api/types/{type_str:path}/fields")
async def type_fields(type_str: str) -> dict:
    try:
        return ok({"type": type_str, "fields": _fields(type_str)})
    except Exception as e:
        raise_http("type_err", f"{type_str}: {e}", HTTP_BAD_REQUEST)


@router.get("/api/srv/{srv_type:path}/fields")
async def srv_fields(srv_type: str) -> dict:
    """service Request 필드 트리 (control.service 동적폼)."""
    try:
        from testbench.ros.service import service_request_fields
        return ok({"type": srv_type, "fields": service_request_fields(srv_type)})
    except Exception as e:
        raise_http("type_err", f"{srv_type}: {e}", HTTP_BAD_REQUEST)
