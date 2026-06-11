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
    def __init__(self, ros: RosBridge, cfg: dict | None = None) -> None:
        self._ros = ros
        self._bridge = CvBridge() if _OK else None
        cfg = cfg or {}
        self.fps = float(cfg.get("fps", 12) or 12)
        self._max_w = int(cfg.get("max_width", 640) or 0)
        self._quality = int(cfg.get("jpeg_quality", 80) or 80)
        # spin 콜백은 raw 프레임만 저장(인코딩 X). 인코딩은 스트림이 스레드풀에서 lazy 수행.
        self._raw: dict[str, tuple] = {}      # topic -> (ttype, msg, seq)
        self._jpeg: dict[str, tuple] = {}     # topic -> (seq, bytes)  인코딩 캐시
        self._seq: dict[str, int] = {}
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
            self._raw.pop(topic, None)
            self._jpeg.pop(topic, None)
            self._seq.pop(topic, None)
            logger.info("카메라 close: %s", topic)
        else:
            self._ref[topic] = n

    def _on(self, topic: str, ttype: str, msg) -> None:
        # ★ spin 스레드: 최신 raw 프레임만 저장(O(1)). 무거운 cv 변환/JPEG 인코딩은 하지 않는다.
        seq = self._seq.get(topic, 0) + 1
        self._seq[topic] = seq
        self._raw[topic] = (ttype, msg, seq)

    def encode_latest(self, topic: str) -> bytes | None:
        """스트림(스레드풀)에서 호출 — 최신 raw 프레임을 JPEG 로 인코딩. 같은 프레임은 캐시 반환."""
        if not _OK:
            return None
        entry = self._raw.get(topic)
        if not entry:
            return None
        ttype, msg, seq = entry
        cached = self._jpeg.get(topic)
        if cached and cached[0] == seq:        # 이미 이 프레임을 인코딩함 → 중복 작업 회피
            return cached[1]
        try:
            if "Compressed" in ttype:
                arr = self._bridge.compressed_imgmsg_to_cv2(msg)
            else:
                arr = self._bridge.imgmsg_to_cv2(msg, desired_encoding="passthrough")
            img = self._to_bgr8(arr)
            if self._max_w and img.shape[1] > self._max_w:   # 인코딩 전 다운스케일(비율 유지)
                h = int(img.shape[0] * self._max_w / img.shape[1])
                img = cv2.resize(img, (self._max_w, h), interpolation=cv2.INTER_AREA)
            ok, buf = cv2.imencode(".jpg", img, [int(cv2.IMWRITE_JPEG_QUALITY), self._quality])
            if ok:
                jpeg = buf.tobytes()
                self._jpeg[topic] = (seq, jpeg)
                return jpeg
        except Exception:  # noqa: BLE001 — compressedDepth 등 미지원 포맷은 스킵
            logger.debug("프레임 변환 실패 %s", topic, exc_info=True)
        return None

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
