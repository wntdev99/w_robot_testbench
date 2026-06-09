"""네비게이션 시각화 — 맵 PNG 렌더 + scan/footprint/robot pose 를 map 프레임 좌표로.

프론트 Canvas 오버레이용. OccupancyGrid 는 PNG 로 렌더(+메타), 동적 오버레이는
경량 좌표 배열(REST 폴링)로 제공. scan/pose 는 tf2 로 map 프레임 변환.
MVP: 시각화만 (init pose / nav goal 인터랙션은 후속).
"""
from __future__ import annotations

import logging
import math

from rclpy.time import Time
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy, DurabilityPolicy

from .ros_bridge import RosBridge

logger = logging.getLogger("testbench.navviz")

try:
    import cv2
    import numpy as np
    _OK = True
except Exception as exc:  # noqa: BLE001
    logger.warning("navviz 의존성(cv2/numpy) 로드 실패: %s", exc)
    _OK = False

try:
    from tf2_ros.buffer import Buffer
    from tf2_ros.transform_listener import TransformListener
    _TF = True
except Exception as exc:  # noqa: BLE001
    logger.warning("tf2_ros 로드 실패: %s", exc)
    _TF = False

BASE_FRAMES = ("base_footprint", "base_link")


def _yaw(q) -> float:
    return math.atan2(2.0 * (q.w * q.z + q.x * q.y), 1.0 - 2.0 * (q.y * q.y + q.z * q.z))


class NavViz:
    def __init__(self, ros: RosBridge) -> None:
        self._ros = ros
        self._started = False
        self._map_msg = None
        self._scan_pts: list = []          # map 프레임 [[x,y],...]
        self._footprint: list = []         # map 프레임 [[x,y],...]
        self._tf: Buffer | None = None
        if _TF:
            self._tf = Buffer()
            TransformListener(self._tf, ros)

    def available(self) -> bool:
        return _OK and _TF

    def ensure_started(self) -> None:
        if self._started:
            return
        self._started = True
        # map: latched(transient_local) 구독
        map_qos = QoSProfile(depth=1, reliability=ReliabilityPolicy.RELIABLE,
                             history=HistoryPolicy.KEEP_LAST, durability=DurabilityPolicy.TRANSIENT_LOCAL)
        try:
            from rosidl_runtime_py.utilities import get_message
            self._ros.create_subscription(
                get_message("nav_msgs/msg/OccupancyGrid"), "/map", self._on_map, map_qos)
        except Exception:  # noqa: BLE001
            logger.exception("map 구독 실패")
        # scan / footprint
        self._ros.subscribe_raw("/scan", "sensor_msgs/msg/LaserScan", self._on_scan, sid="navviz")
        self._ros.subscribe_raw("/global_costmap/published_footprint",
                                "geometry_msgs/msg/PolygonStamped", self._on_footprint, sid="navviz")
        logger.info("NavViz 구독 시작")

    # ── TF 헬퍼: map <- frame 의 (tx, ty, yaw) ──
    def _tf_map_from(self, frame: str):
        if not self._tf or not frame:
            return None
        try:
            tr = self._tf.lookup_transform("map", frame, Time())
            t = tr.transform.translation
            return (t.x, t.y, _yaw(tr.transform.rotation))
        except Exception:  # noqa: BLE001 — TF 미존재/외삽 등
            return None

    @staticmethod
    def _apply(tf, xs, ys):
        tx, ty, yaw = tf
        c, s = math.cos(yaw), math.sin(yaw)
        return [[tx + c * x - s * y, ty + s * x + c * y] for x, y in zip(xs, ys)]

    # ── 콜백 ──
    def _on_map(self, msg) -> None:
        self._map_msg = msg

    def _on_scan(self, msg) -> None:
        if not _OK:
            return
        tf = self._tf_map_from(msg.header.frame_id)
        if tf is None:
            self._scan_pts = []
            return
        ranges = np.asarray(msg.ranges, dtype=np.float32)
        n = len(ranges)
        angles = msg.angle_min + np.arange(n, dtype=np.float32) * msg.angle_increment
        valid = np.isfinite(ranges) & (ranges >= msg.range_min) & (ranges <= msg.range_max)
        # 다운샘플: 최대 ~720점
        if valid.sum() > 720:
            idx = np.where(valid)[0][:: max(1, valid.sum() // 720)]
        else:
            idx = np.where(valid)[0]
        xs = (ranges[idx] * np.cos(angles[idx]))
        ys = (ranges[idx] * np.sin(angles[idx]))
        self._scan_pts = self._apply(tf, xs.tolist(), ys.tolist())

    def _on_footprint(self, msg) -> None:
        frame = msg.header.frame_id or "map"
        pts = [(p.x, p.y) for p in msg.polygon.points]
        if frame == "map":
            self._footprint = [[x, y] for x, y in pts]
            return
        tf = self._tf_map_from(frame)
        if tf is None:
            self._footprint = []
            return
        self._footprint = self._apply(tf, [p[0] for p in pts], [p[1] for p in pts])

    # ── 출력 ──
    def map_meta(self) -> dict:
        m = self._map_msg
        if not m:
            return {"has_map": False}
        info = m.info
        return {
            "has_map": True,
            "resolution": info.resolution,
            "width": info.width, "height": info.height,
            "origin": {"x": info.origin.position.x, "y": info.origin.position.y},
        }

    def map_png(self) -> bytes | None:
        m = self._map_msg
        if not m or not _OK:
            return None
        w, h = m.info.width, m.info.height
        data = np.asarray(m.data, dtype=np.int16).reshape(h, w)
        img = np.full((h, w), 128, np.uint8)            # unknown=회색
        known = data >= 0
        img[known] = (255 - (np.clip(data[known], 0, 100) * 255 // 100)).astype(np.uint8)
        img = np.flipud(img)                            # origin 좌하단 → 이미지 상단=최대 y
        ok, buf = cv2.imencode(".png", img)
        return buf.tobytes() if ok else None

    def overlay(self) -> dict:
        pose = None
        for bf in BASE_FRAMES:
            tf = self._tf_map_from(bf)
            if tf:
                pose = {"x": tf[0], "y": tf[1], "yaw": tf[2]}
                break
        return {"pose": pose, "footprint": self._footprint, "scan": self._scan_pts}
