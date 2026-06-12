"""카메라 — 이미지 토픽 → JPEG 프레임 (단일 프레임 폴링용).

cv_bridge + cv2 로 sensor_msgs/Image·CompressedImage 를 JPEG 로 변환.
ros_bridge.subscribe_raw 로 원본 msg 수신(ordereddict 변환 회피).

연결 모델: 영속 MJPEG 스트림(브라우저 HTTP/1.1 origin당 ~6연결 고갈 유발) 대신,
프론트가 GET /api/camera/frame 으로 fps 마다 1장씩 폴링한다. 동시 활성 카메라는
max_concurrent 개로 제한하고, 일정 시간 폴링이 끊긴 토픽은 TTL 로 자동 구독 해제.
"""
from __future__ import annotations

import logging
import threading

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
        self.max_concurrent = int(cfg.get("max_concurrent", 3) or 3)
        self._ttl = float(cfg.get("idle_ttl_s", 4) or 4)   # 폴링 끊긴 토픽 자동 구독해제 시간
        # spin 콜백은 raw 프레임만 저장(인코딩 X). 인코딩은 요청이 스레드풀에서 lazy 수행.
        self._raw: dict[str, tuple] = {}      # topic -> (ttype, msg, seq)
        self._jpeg: dict[str, tuple] = {}     # topic -> (seq, bytes)  인코딩 캐시
        self._seq: dict[str, int] = {}
        self._active: dict[str, float] = {}   # 구독 중 topic -> 마지막 폴링 시각
        self._lock = threading.Lock()         # _active/구독 생성·해제 보호

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

    def _open(self, topic: str) -> None:
        ttype = self._ros.get_topic_type(topic)
        self._ros.subscribe_raw(topic, ttype,
                                lambda msg, _t=topic, _ty=ttype: self._on(_t, _ty, msg),
                                sid=f"cam:{topic}")
        logger.info("카메라 open: %s (활성 %d/%d)", topic, len(self._active) + 1, self.max_concurrent)

    def _close(self, topic: str) -> None:
        self._ros.unsubscribe_raw(topic, sid=f"cam:{topic}")
        self._raw.pop(topic, None)
        self._jpeg.pop(topic, None)
        self._seq.pop(topic, None)
        logger.info("카메라 close: %s", topic)

    def keep(self, topic: str, now: float, display: bool = True) -> tuple[str, bytes | None]:
        """폴링/keep-alive 1회 — 필요 시 구독 시작 후 TTL 갱신.
        display=True: 인코딩 프레임 반환(표시). 동시 '표시' 수만 max_concurrent 로 제한.
        display=False: 구독만 유지(로드 테스트) — 인코딩·표시 없음, 개수 제한 없음.
        반환 status: 'ok'|'pending'(표시) | 'subonly'(구독만) | 'limit'(표시 슬롯 초과)."""
        with self._lock:
            cur = self._active.get(topic)
            exists = cur is not None
            was_display = bool(cur and cur[1])
            if display and not was_display:
                # 새로 '표시'를 요청 — 표시 슬롯이 차 있으면 구독은 유지하되 표시는 거부
                active_disp = sum(1 for v in self._active.values() if v[1])
                if active_disp >= self.max_concurrent:
                    if not exists:
                        self._open(topic)
                    self._active[topic] = (now, False)
                    return ("limit", None)
            if not exists:
                self._open(topic)
            self._active[topic] = (now, display)
        if not display:
            return ("subonly", None)
        frame = self.encode_latest(topic)
        return ("ok", frame) if frame else ("pending", None)

    def reap(self, now: float) -> None:
        """폴링/keep-alive 가 끊긴(TTL 초과) 토픽의 구독을 해제 — 슬롯 반납."""
        with self._lock:
            stale = [t for t, v in self._active.items() if now - v[0] > self._ttl]
            for t in stale:
                self._active.pop(t, None)
                self._close(t)

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
