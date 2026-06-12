"""카메라 API — 이미지 토픽 목록 + 단일 프레임 폴링.

영속 MJPEG 스트림은 브라우저 HTTP/1.1 origin당 ~6연결 한도를 카메라 수만큼 점유해
저장 등 다른 요청을 막는다. 그래서 프론트가 fps 마다 1장씩 GET /frame 으로 폴링한다.
"""
from __future__ import annotations

import asyncio
import time

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

router = APIRouter(prefix="/api/camera", tags=["camera"])


@router.get("/topics")
async def image_topics(request: Request):
    cam = request.app.state.ctx.cam
    return {"available": cam.available(), "topics": cam.list_image_topics()}


@router.get("/frame")
async def frame(topic: str, request: Request, display: int = 1):
    """display=1: 표시(인코딩 프레임). display=0: 구독만 유지(로드 테스트 keep-alive, 무제한)."""
    cam = request.app.state.ctx.cam
    if not cam.available():
        raise HTTPException(503, "카메라 변환 의존성(cv2/cv_bridge) 없음")
    loop = asyncio.get_event_loop()
    # 구독 시작 + cv 변환/JPEG 인코딩은 이벤트루프/spin 을 막지 않도록 스레드풀에서
    status, data = await loop.run_in_executor(None, cam.keep, topic, time.time(), bool(display))
    if status == "limit":
        raise HTTPException(429, f"동시 카메라 표시 제한({cam.max_concurrent}대) 초과 — 구독은 유지됨")
    if not data:
        return Response(status_code=204)        # subonly 이거나 아직 프레임 없음
    return Response(content=data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})
