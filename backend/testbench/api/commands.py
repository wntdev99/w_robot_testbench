# Copyright 2026 WATT — Apache-2.0
"""동적 명령 API — publish (DESIGN v0.3 §7.1). service/action 은 향후."""
from __future__ import annotations

from fastapi import APIRouter, Request
from pydantic import BaseModel

from testbench.api.common import HTTP_BAD_REQUEST, ok, raise_http

router = APIRouter()


class PublishBody(BaseModel):
    topic: str
    type: str
    values: dict = {}


@router.post("/api/publish")
async def publish(request: Request, body: PublishBody) -> dict:
    try:
        result = request.app.state.publisher_pool.publish(body.topic, body.type, body.values)
    except Exception as e:
        raise_http("publish_failed", str(e), HTTP_BAD_REQUEST)
    return ok(result)
