# Copyright 2026 WATT — Apache-2.0
"""카메라 MJPEG 스트림 API (image 위젯)."""
from __future__ import annotations

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter()


@router.get("/api/camera/stream")
async def camera_stream(request: Request, topic: str, type: str = "sensor_msgs/msg/CompressedImage"):
    streamer = request.app.state.camera_streamer
    return StreamingResponse(
        streamer.mjpeg(topic, type),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )
