"""토픽/명령 API — 런타임 토픽 발견, publish/service, controller_manager, subsystems."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter(prefix="/api", tags=["ros"])


@router.get("/topics")
async def list_topics(request: Request, include_hidden: bool = False):
    # 매 호출이 라이브 그래프를 새로 조회 → 프론트의 새로고침이 곧 런타임 갱신
    return request.app.state.ctx.ros.list_topics(include_hidden=include_hidden)


@router.get("/topics/type")
async def topic_type(topic: str, request: Request):
    t = request.app.state.ctx.ros.get_topic_type(topic)
    if not t:
        raise HTTPException(404, f"토픽 미발견 또는 타입 미상: {topic}")
    return {"topic": topic, "type": t}


@router.get("/topics/fields")
async def topic_fields(topic: str, request: Request, type: str | None = None):
    """토픽 메시지 타입의 플롯 가능한 수치 필드를 타입 정의로 미리 추출."""
    ros = request.app.state.ctx.ros
    ttype = type or ros.get_topic_type(topic)
    if not ttype:
        raise HTTPException(404, f"토픽 타입 미상(미발행): {topic}. type 파라미터로 지정 가능")
    fields = ros.topic_fields(ttype)
    return {
        "topic": topic,
        "type": ttype,
        "fields": fields,
        "plottable_fields": [f for f in fields if f["plottable"]],
        "plottable": any(f["plottable"] for f in fields),
    }


@router.get("/services")
async def list_services(request: Request):
    return request.app.state.ctx.ros.list_services()


@router.get("/services/fields")
async def service_fields(service: str, request: Request, type: str | None = None):
    """서비스 Request 의 필드를 타입 정의로 미리 추출(명령 폼 생성용)."""
    ros = request.app.state.ctx.ros
    stype = type
    if not stype:
        for n, types in ros.get_service_names_and_types():
            if n == service and types:
                stype = types[0]
                break
    if not stype:
        raise HTTPException(404, f"서비스 타입 미상: {service}. type 파라미터로 지정 가능")
    return {"service": service, "type": stype, "fields": ros.service_request_fields(stype)}


@router.get("/diagnostics")
async def diagnostics(request: Request):
    return request.app.state.ctx.ros.diagnostics_snapshot()


@router.get("/subsystems")
async def subsystems(request: Request):
    cfg = request.app.state.ctx.cfg
    return [s.raw for s in cfg.subsystems.values()]


class PublishBody(BaseModel):
    topic: str
    type: str
    data: dict


@router.post("/publish")
async def publish(body: PublishBody, request: Request):
    try:
        request.app.state.ctx.ros.publish_once(body.topic, body.type, body.data)
        return {"ok": True}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


class ServiceBody(BaseModel):
    type: str
    name: str
    request: dict = {}


@router.post("/service")
async def call_service(body: ServiceBody, request: Request):
    try:
        res = request.app.state.ctx.ros.call_service_sync(body.type, body.name, body.request)
        return {"ok": True, "response": res}
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))


@router.get("/controllers")
async def controllers(request: Request):
    try:
        return request.app.state.ctx.ros.list_controllers()
    except Exception as e:  # noqa: BLE001
        raise HTTPException(503, str(e))


class SwitchBody(BaseModel):
    activate: list[str] = []
    deactivate: list[str] = []


@router.post("/controllers/switch")
async def switch_controller(body: SwitchBody, request: Request):
    try:
        return request.app.state.ctx.ros.switch_controller(body.activate, body.deactivate)
    except Exception as e:  # noqa: BLE001
        raise HTTPException(400, str(e))
