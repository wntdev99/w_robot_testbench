"""앱 공유 상태 — 라우터가 request.app.state.ctx 로 접근."""
from __future__ import annotations

from dataclasses import dataclass

from .camera import CameraManager
from .config import Config
from .navviz import NavViz
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
    nav: NavViz
    controller_reachable: bool | None = None   # ping 도달
    controller_ssh_ok: bool | None = None       # 키 기반 SSH 인증 성공(원격 명령 가능)
