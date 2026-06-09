"""카메라 — 이미지 토픽 → JPEG 프레임 (MJPEG 스트림용).

cv_bridge + cv2 로 sensor_msgs/Image·CompressedImage 를 JPEG 로 변환.
ros_bridge.subscribe_raw 로 원본 msg 수신(ordereddict 변환 회피). 토픽당 refcount.
depth(비 uint8)는 정규화 + 컬러맵.
"""
from __future__ import annotations

import logging

from .ros_bridge import RosBridge

logger = logging.getLogger("testbench.camera")

try:
    import cv2
    import numpy as np
    from cv_bridge import CvBridge
    _OK = True
except Exception as exc:  # noqa: BLE001
    logger.warning("카메라 의존성 로드 실패(cv2/cv_bridge): %s", exc)
    _OK = False

IMAGE_TYPES = ("sensor_msgs/msg/Image", "sensor_msgs/msg/CompressedImage")


class CameraManager:
    def __init__(self, ros: RosBridge) -> None:
        self._ros = ros
        self._bridge = CvBridge() if _OK else None
        self._latest: dict[str, bytes] = {}
        self._ref: dict[str, int] = {}

    def available(self) -> bool:
        return _OK

    def list_image_topics(self) -> list[dict]:
        out = []
        for name, types in self._ros.get_topic_names_and_types():
            t0 = types[0] if types else ""
            norm = t0.replace("/msg/", "/")
            if any(norm == it.replace("/msg/", "/") for it in IMAGE_TYPES):
                out.append({"topic": name, "type": t0,
                            "compressed": "Compressed" in t0})
        return sorted(out, key=lambda x: x["topic"])

    def open(self, topic: str) -> None:
        self._ref[topic] = self._ref.get(topic, 0) + 1
        if self._ref[topic] > 1:
            return
        ttype = self._ros.get_topic_type(topic)
        self._ros.subscribe_raw(topic, ttype,
                                lambda msg, _t=topic, _ty=ttype: self._on(_t, _ty, msg),
                                sid=f"cam:{topic}")
        logger.info("카메라 open: %s", topic)

    def close(self, topic: str) -> None:
        n = self._ref.get(topic, 0) - 1
        if n <= 0:
            self._ref.pop(topic, None)
            self._ros.unsubscribe_raw(topic, sid=f"cam:{topic}")
            self._latest.pop(topic, None)
            logger.info("카메라 close: %s", topic)
        else:
            self._ref[topic] = n

    def latest(self, topic: str) -> bytes | None:
        return self._latest.get(topic)

    def _on(self, topic: str, ttype: str, msg) -> None:
        if not _OK:
            return
        try:
            if "Compressed" in ttype:
                arr = self._bridge.compressed_imgmsg_to_cv2(msg)
            else:
                arr = self._bridge.imgmsg_to_cv2(msg, desired_encoding="passthrough")
            img = self._to_bgr8(arr)
            ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if ok:
                self._latest[topic] = buf.tobytes()
        except Exception:  # noqa: BLE001 — compressedDepth 등 미지원 포맷은 스킵
            logger.debug("프레임 변환 실패 %s", topic, exc_info=True)

    def _to_bgr8(self, arr):
        # depth/float/16bit → 정규화 + 컬러맵
        if arr.dtype != np.uint8:
            norm = cv2.normalize(arr, None, 0, 255, cv2.NORM_MINMAX).astype("uint8")
            return cv2.applyColorMap(norm, cv2.COLORMAP_JET)
        if arr.ndim == 2:
            return cv2.cvtColor(arr, cv2.COLOR_GRAY2BGR)
        if arr.shape[2] == 4:
            return cv2.cvtColor(arr, cv2.COLOR_BGRA2BGR)
        return arr
