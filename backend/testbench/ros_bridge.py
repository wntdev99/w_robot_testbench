"""ROS2 브리지 — rclpy Node + 백그라운드 executor 스레드.

bt_web_bridge/ros_bridge 패턴 계승하되 BT 종속 제거(범용화).
제공 기능:
  - 토픽/타입 런타임 발견 (introspect)
  - 임의 타입 동적 구독 → 콜백 (subscriber_pool 이 throttle+WS 브로드캐스트)
  - /diagnostics(DiagnosticArray) 상시 구독 → hardware_id/field 시계열
  - 동적 publish / service 호출 (rclpy future → asyncio future)
  - controller_manager list/switch

rclpy future 는 executor 스레드에서 완료되므로, asyncio 쪽은 polling 헬퍼로 await 한다.
"""
from __future__ import annotations

import asyncio
import logging
import re
import threading
from typing import Any, Callable

import rclpy
from rclpy.action import ActionClient, get_action_names_and_types
from rclpy.executors import SingleThreadedExecutor
from rclpy.node import Node
from rclpy.qos import QoSProfile, ReliabilityPolicy, HistoryPolicy

from rosidl_runtime_py.utilities import get_action, get_message, get_service
from rosidl_runtime_py import message_to_ordereddict, set_message_fields

logger = logging.getLogger("testbench.ros")

DIAGNOSTICS_TYPE = "diagnostic_msgs/msg/DiagnosticArray"


def _normalize_type(type_str: str) -> str:
    """'pkg/Msg' 또는 'pkg/msg/Msg' → 'pkg/msg/Msg' 로 정규화."""
    parts = type_str.split("/")
    if len(parts) == 2:
        return f"{parts[0]}/msg/{parts[1]}"
    return type_str


# rosidl 수치 primitive (플롯 가능). boolean 은 0/1 로 플롯.
_NUMERIC_PRIMS = {
    "float", "double", "float32", "float64",
    "int8", "uint8", "int16", "uint16", "int32", "uint32", "int64", "uint64",
    "byte", "char", "octet", "boolean", "bool",
}


def _normalize_service(type_str: str) -> str:
    """'pkg/Srv' → 'pkg/srv/Srv' 정규화."""
    parts = type_str.split("/")
    if len(parts) == 2:
        return f"{parts[0]}/srv/{parts[1]}"
    return type_str


def _normalize_action(type_str: str) -> str:
    """'pkg/Action' → 'pkg/action/Action' 정규화."""
    parts = type_str.split("/")
    if len(parts) == 2:
        return f"{parts[0]}/action/{parts[1]}"
    return type_str


def _split_array(ftype: str) -> tuple[str, bool]:
    """'sequence<double>' / 'double[3]' / 'sequence<double, 5>' → ('double', True)."""
    m = re.match(r"^sequence<(.+?)(?:,\s*\d+)?>$", ftype)
    if m:
        return m.group(1).strip(), True
    m = re.match(r"^(.+?)\[\d*\]$", ftype)
    if m:
        return m.group(1).strip(), True
    return ftype.strip(), False


class RosBridge(Node):
    def __init__(self) -> None:
        super().__init__("w_robot_testbench")
        self._executor: SingleThreadedExecutor | None = None
        self._thread: threading.Thread | None = None
        self._subs: dict[str, Any] = {}                  # topic -> Subscription
        self._sub_cbs: dict[str, Callable[[dict], None]] = {}
        # diagnostics 최신값: { hardware_id: { field: value, ... , "_name": status.name } }
        self._diag_latest: dict[str, dict[str, Any]] = {}
        self._diag_cb: Callable[[dict], None] | None = None
        self._diag_sub = None
        self._field_cache: dict[str, list[dict[str, Any]]] = {}   # type_str -> leaf fields
        self._goals: dict[str, tuple] = {}                        # goal_id -> (ActionClient, goal_handle)
        self._goal_seq = 0

    # ── 생명주기 ──
    def start(self) -> None:
        self._executor = SingleThreadedExecutor()
        self._executor.add_node(self)
        self._thread = threading.Thread(target=self._spin, name="ros-spin", daemon=True)
        self._thread.start()
        self._subscribe_diagnostics()
        logger.info("RosBridge spin 스레드 시작")

    def _spin(self) -> None:
        try:
            self._executor.spin()
        except Exception as exc:  # noqa: BLE001
            logger.exception("executor spin 종료: %s", exc)

    def shutdown(self) -> None:
        if self._executor:
            self._executor.shutdown()
        self.destroy_node()

    # ── introspection ──
    @staticmethod
    def _is_hidden(name: str) -> bool:
        leaf = name.rsplit("/", 1)[-1]
        return ("/_action/" in name or "/_service_event" in name
                or leaf.startswith("_") or "/_" in name)

    def list_topics(self, include_hidden: bool = False) -> list[dict[str, Any]]:
        out = []
        for name, types in self.get_topic_names_and_types():
            if not include_hidden and self._is_hidden(name):
                continue
            out.append({
                "topic": name,
                "types": types,
                # publishers>0 이어야 실제 데이터가 흐른다 (구독만으로는 값 없음)
                "publishers": self.count_publishers(name),
                "subscribers": self.count_subscribers(name),
                # 타입 정의로 미리 판정 — 수치 필드가 하나라도 있으면 플롯 가능
                "plottable": any(f["plottable"] for f in self.topic_fields(types[0])) if types else False,
            })
        return sorted(out, key=lambda x: x["topic"])

    def topic_fields(self, type_str: str) -> list[dict[str, Any]]:
        """메시지 타입 정의를 재귀 분석해 leaf 필드 목록 반환 (런타임 메시지 불필요).

        각 항목: {path, base_type, array(bool), plottable(bool)}.
        plottable=수치 스칼라 또는 수치 배열. 결과는 타입별 캐시.
        """
        if not type_str:
            return []
        norm = _normalize_type(type_str)
        if norm in self._field_cache:
            return self._field_cache[norm]
        out: list[dict[str, Any]] = []
        try:
            self._fields_of_class(get_message(norm), "", out, 0)
        except Exception as exc:  # noqa: BLE001 — 미빌드/외부 타입 등
            logger.debug("타입 필드 분석 실패 %s: %s", type_str, exc)
        self._field_cache[norm] = out
        return out

    def service_request_fields(self, srv_type: str) -> list[dict[str, Any]]:
        """서비스 Request 타입의 leaf 필드 목록 (명령 폼 생성용)."""
        if not srv_type:
            return []
        norm = _normalize_service(srv_type)
        cache_key = f"srv:{norm}"
        if cache_key in self._field_cache:
            return self._field_cache[cache_key]
        out: list[dict[str, Any]] = []
        try:
            self._fields_of_class(get_service(norm).Request, "", out, 0)
        except Exception as exc:  # noqa: BLE001
            logger.debug("서비스 필드 분석 실패 %s: %s", srv_type, exc)
        self._field_cache[cache_key] = out
        return out

    def _fields_of_class(self, cls: Any, prefix: str, out: list, depth: int) -> None:
        if depth > 5:
            return
        for name, ftype in cls.get_fields_and_field_types().items():
            if name == "header" and depth == 0:
                continue
            base, is_array = _split_array(ftype)
            path = f"{prefix}.{name}" if prefix else name
            if "/" in base:  # 중첩 메시지
                if is_array:
                    continue  # 메시지 배열은 별도 처리 영역
                self._fields_of_class(get_message(_normalize_type(base)), path, out, depth + 1)
            else:
                out.append({
                    "path": path,
                    "base_type": base,
                    "array": is_array,
                    "plottable": base in _NUMERIC_PRIMS,
                })

    def get_topic_type(self, topic: str) -> str | None:
        for name, types in self.get_topic_names_and_types():
            if name == topic and types:
                return types[0]
        return None

    def list_services(self) -> list[dict[str, Any]]:
        return [
            {"service": n, "types": t}
            for n, t in self.get_service_names_and_types()
        ]

    # ── 동적 구독 ──
    def subscribe(self, topic: str, type_str: str | None, cb: Callable[[dict], None]) -> bool:
        if topic in self._subs:
            self._sub_cbs[topic] = cb
            return True
        type_str = type_str or self.get_topic_type(topic)
        if not type_str:
            logger.warning("구독 실패(타입 미상): %s", topic)
            return False
        try:
            msg_cls = get_message(_normalize_type(type_str))
        except Exception as exc:  # noqa: BLE001
            logger.warning("메시지 타입 로드 실패 %s: %s", type_str, exc)
            return False

        self._sub_cbs[topic] = cb

        def _on_msg(msg: Any, _topic: str = topic) -> None:
            try:
                data = message_to_ordereddict(msg)
                self._sub_cbs[_topic](dict(data))
            except Exception:  # noqa: BLE001
                logger.exception("구독 콜백 오류 %s", _topic)

        qos = QoSProfile(depth=10, reliability=ReliabilityPolicy.BEST_EFFORT,
                         history=HistoryPolicy.KEEP_LAST)
        self._subs[topic] = self.create_subscription(msg_cls, topic, _on_msg, qos)
        logger.info("구독 시작: %s (%s)", topic, type_str)
        return True

    def unsubscribe(self, topic: str) -> None:
        sub = self._subs.pop(topic, None)
        self._sub_cbs.pop(topic, None)
        if sub is not None:
            self.destroy_subscription(sub)
            logger.info("구독 해제: %s", topic)

    # ── diagnostics 상시 구독 ──
    def set_diagnostics_callback(self, cb: Callable[[dict], None]) -> None:
        self._diag_cb = cb

    def _subscribe_diagnostics(self) -> None:
        try:
            msg_cls = get_message(DIAGNOSTICS_TYPE)
        except Exception as exc:  # noqa: BLE001
            logger.warning("diagnostics 타입 로드 실패: %s", exc)
            return
        qos = QoSProfile(depth=50, reliability=ReliabilityPolicy.RELIABLE,
                         history=HistoryPolicy.KEEP_LAST)
        self._diag_sub = self.create_subscription(
            msg_cls, "/diagnostics", self._on_diagnostics, qos
        )

    @staticmethod
    def _level_int(level: Any) -> int:
        # DiagnosticStatus.level 은 byte 필드 → rclpy 가 bytes(len 1) 로 전달.
        if isinstance(level, (bytes, bytearray)):
            return level[0] if level else 0
        return int(level)

    def _on_diagnostics(self, msg: Any) -> None:
        try:
            updated: dict[str, dict[str, Any]] = {}
            for status in msg.status:
                hid = status.hardware_id or status.name
                fields = {kv.key: kv.value for kv in status.values}
                fields["_name"] = status.name
                fields["_level"] = self._level_int(status.level)
                self._diag_latest[hid] = fields
                updated[hid] = fields
            if self._diag_cb and updated:
                self._diag_cb(updated)
        except Exception:  # noqa: BLE001 — 한 메시지 오류가 spin 을 죽이지 않도록
            logger.exception("diagnostics 콜백 오류")

    def diagnostics_snapshot(self) -> dict[str, dict[str, Any]]:
        return dict(self._diag_latest)

    # ── publish ──
    def publish_once(self, topic: str, type_str: str, data: dict) -> None:
        msg_cls = get_message(_normalize_type(type_str))
        pub = self.create_publisher(msg_cls, topic, 10)
        msg = msg_cls()
        set_message_fields(msg, data)
        pub.publish(msg)
        # 짧게 유지 후 정리 (one-shot)
        self.destroy_publisher(pub)

    # ── service (동기 호출, executor 스레드에서 spin) ──
    def call_service_sync(self, srv_type: str, name: str, request: dict, timeout: float = 5.0) -> dict:
        srv_cls = get_service(_normalize_service(srv_type))
        client = self.create_client(srv_cls, name)
        if not client.wait_for_service(timeout_sec=timeout):
            self.destroy_client(client)
            raise TimeoutError(f"서비스 미발견: {name}")
        req = srv_cls.Request()
        set_message_fields(req, request or {})
        future = client.call_async(req)
        # executor 스레드가 spin 중이므로 future 완료를 polling
        import time
        deadline = time.time() + timeout
        while not future.done() and time.time() < deadline:
            time.sleep(0.02)
        self.destroy_client(client)
        if not future.done():
            raise TimeoutError(f"서비스 응답 시간초과: {name}")
        return dict(message_to_ordereddict(future.result()))

    # ── controller_manager ──
    def list_controllers(self) -> list[dict[str, Any]]:
        res = self.call_service_sync(
            "controller_manager_msgs/srv/ListControllers",
            "/controller_manager/list_controllers", {},
        )
        return res.get("controller", [])

    def switch_controller(self, activate: list[str], deactivate: list[str]) -> dict:
        return self.call_service_sync(
            "controller_manager_msgs/srv/SwitchController",
            "/controller_manager/switch_controller",
            {
                "activate_controllers": activate,
                "deactivate_controllers": deactivate,
                "strictness": 2,  # STRICT
                "activate_asap": True,
            },
        )

    # ── 액션 (goal/feedback/result/cancel) ──
    def list_actions(self) -> list[dict[str, Any]]:
        out = []
        for name, types in get_action_names_and_types(self):
            out.append({"action": name, "types": types})
        return sorted(out, key=lambda x: x["action"])

    def action_goal_fields(self, action_type: str) -> list[dict[str, Any]]:
        if not action_type:
            return []
        norm = _normalize_action(action_type)
        key = f"act:{norm}"
        if key in self._field_cache:
            return self._field_cache[key]
        out: list[dict[str, Any]] = []
        try:
            self._fields_of_class(get_action(norm).Goal, "", out, 0)
        except Exception as exc:  # noqa: BLE001
            logger.debug("액션 Goal 필드 분석 실패 %s: %s", action_type, exc)
        self._field_cache[key] = out
        return out

    def send_action_goal(self, action_type: str, name: str, goal: dict,
                         on_feedback: Callable[[str, dict], None],
                         on_result: Callable[[str, dict], None],
                         timeout: float = 5.0) -> dict:
        """액션 goal 전송. goal 수락 여부를 동기 반환하고, feedback/result 는 콜백으로 비동기 전달."""
        import time
        norm = _normalize_action(action_type)
        act_cls = get_action(norm)
        client = ActionClient(self, act_cls, name)
        if not client.wait_for_server(timeout_sec=timeout):
            client.destroy()
            raise TimeoutError(f"액션 서버 미발견: {name}")
        self._goal_seq += 1
        gid = f"g{self._goal_seq}"
        goal_msg = act_cls.Goal()
        set_message_fields(goal_msg, goal or {})

        def _fb(fb_msg: Any, _gid: str = gid) -> None:
            try:
                on_feedback(_gid, dict(message_to_ordereddict(fb_msg.feedback)))
            except Exception:  # noqa: BLE001
                logger.exception("액션 feedback 콜백 오류")

        send_future = client.send_goal_async(goal_msg, feedback_callback=_fb)
        deadline = time.time() + timeout
        while not send_future.done() and time.time() < deadline:
            time.sleep(0.02)
        if not send_future.done():
            client.destroy()
            raise TimeoutError("goal 전송 시간초과")
        handle = send_future.result()
        if not handle.accepted:
            client.destroy()
            return {"goal_id": gid, "accepted": False}

        self._goals[gid] = (client, handle)
        result_future = handle.get_result_async()

        def _done(fut: Any, _gid: str = gid, _client: Any = client) -> None:
            try:
                r = fut.result()
                on_result(_gid, {"status": int(r.status),
                                 "result": dict(message_to_ordereddict(r.result))})
            except Exception:  # noqa: BLE001
                logger.exception("액션 result 콜백 오류")
            finally:
                self._goals.pop(_gid, None)
                _client.destroy()

        result_future.add_done_callback(_done)
        return {"goal_id": gid, "accepted": True}

    def cancel_action(self, goal_id: str) -> dict:
        g = self._goals.get(goal_id)
        if not g:
            return {"ok": False, "reason": "unknown goal_id"}
        g[1].cancel_goal_async()
        return {"ok": True, "goal_id": goal_id}
