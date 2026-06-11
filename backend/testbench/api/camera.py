"""카메라 API — 이미지 토픽 목록 + MJPEG 스트림."""
from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/api/camera", tags=["camera"])


@router.get("/topics")
async def image_topics(request: Request):
    cam = request.app.state.ctx.cam
    return {"available": cam.available(), "topics": cam.list_image_topics()}


@router.get("/stream")
async def stream(topic: str, request: Request):
    cam = request.app.state.ctx.cam
    if not cam.available():
        raise HTTPException(503, "카메라 변환 의존성(cv2/cv_bridge) 없음")
    cam.open(topic)
    loop = asyncio.get_event_loop()
    period = 1 / max(1.0, cam.fps)

    async def gen():
        try:
            while True:
                if await request.is_disconnected():
                    break
                # 인코딩(cv 변환+JPEG)은 spin/이벤트루프를 막지 않도록 스레드풀에서 — 멀티코어 분산
                frame = await loop.run_in_executor(None, cam.encode_latest, topic)
                if frame:
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\n"
                           b"Content-Length: " + str(len(frame)).encode() + b"\r\n\r\n"
                           + frame + b"\r\n")
                await asyncio.sleep(period)
        finally:
            cam.close(topic)

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")
