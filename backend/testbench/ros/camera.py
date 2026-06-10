# Copyright 2026 WATT — Apache-2.0
"""카메라 MJPEG 스트림 (L7, DESIGN v0.3 §3 영상 파이프라인).

토픽 구독 → 최신 JPEG 프레임 보관 → multipart/x-mixed-replace 스트림.
CompressedImage: data 가 곧 JPEG(인코딩 불필요). Image(raw): pillow 로 JPEG 인코딩.
"""
from __future__ import annotations

import asyncio
import io
import logging

from rosidl_runtime_py.utilities import get_message

logger = logging.getLogger(__name__)


def _raw_to_jpeg(msg) -> bytes | None:
    try:
        from PIL import Image as PILImage
    except Exception:
        return None  # pillow 없으면 raw 미지원(CompressedImage는 정상)
    enc = getattr(msg, "encoding", "")
    mode = {"rgb8": "RGB", "bgr8": "RGB", "mono8": "L"}.get(enc)
    if not mode:
        return None
    try:
        img = PILImage.frombytes(mode, (msg.width, msg.height), bytes(msg.data))
        if enc == "bgr8":
            b, g, r = img.split()
            img = PILImage.merge("RGB", (r, g, b))
        buf = io.BytesIO()
        img.save(buf, "JPEG", quality=70)
        return buf.getvalue()
    except Exception as e:
        logger.warning("raw→jpeg 실패: %s", e)
        return None


class CameraStreamer:
    def __init__(self, node) -> None:
        self.node = node
        self._frames: dict[str, bytes] = {}
        self._subs: dict[str, object] = {}

    def ensure(self, topic: str, type_str: str) -> None:
        if topic in self._subs:
            return
        try:
            msg_type = get_message(type_str)
        except Exception as e:
            logger.warning("camera 타입 로드 실패 %s: %s", type_str, e)
            return
        compressed = "CompressedImage" in type_str

        def cb(msg, t=topic, comp=compressed):
            if comp:
                self._frames[t] = bytes(msg.data)
            else:
                jpeg = _raw_to_jpeg(msg)
                if jpeg:
                    self._frames[t] = jpeg

        self._subs[topic] = self.node.create_subscription(msg_type, topic, cb, 5)
        logger.info("camera subscribe %s (%s)", topic, type_str)

    async def mjpeg(self, topic: str, type_str: str):
        self.ensure(topic, type_str)
        try:
            while True:
                frame = self._frames.get(topic)
                if frame:
                    yield (b"--frame\r\nContent-Type: image/jpeg\r\n\r\n" + frame + b"\r\n")
                await asyncio.sleep(0.05)  # ~20 fps
        except asyncio.CancelledError:
            pass
