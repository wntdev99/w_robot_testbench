"""앱 공유 상태 — 라우터가 request.app.state.ctx 로 접근."""
from __future__ import annotations

from dataclasses import dataclass

from .camera import CameraManager
from .config import Config
from .procman.orchestrator import Orchestrator
from .recorder import Recorder
from .ros_bridge import RosBridge
from .ros.stream import StreamHub
from .ws_manager import WsManager


@dataclass
class Context:
    cfg: Config
    ros: RosBridge
    ws: WsManager
    orch: Orchestrator
    stream: StreamHub
    recorder: Recorder
    cam: CameraManager
    controller_reachable: bool | None = None
