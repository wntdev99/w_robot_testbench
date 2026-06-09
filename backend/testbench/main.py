# Copyright 2026 WATT — Apache-2.0
"""w_robot_testbench 백엔드 entrypoint (DESIGN v0.3).

기동 순서 (bt_web_bridge 패턴 계승):
    1. Config 로드 (testbench.yaml + baseline.yaml)
    2. rclpy.init() → RosBridge + SingleThreadedExecutor (백그라운드 스레드)
    3. PREBOOT_SCAN — Clean-Slate 게이트(부속 D §2.5): 기존 ROS 프로세스 스캔
    4. FastAPI app + 라우터 + uvicorn
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import signal
import sys
import threading

import rclpy
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from rclpy.executors import SingleThreadedExecutor

from testbench.api.baseline import router as baseline_router
from testbench.api.boot import router as boot_router
from testbench.api.emergency import router as emergency_router
from testbench.api.system import router as system_router
from testbench.api.ws import router as ws_router
from testbench.config import Config
from testbench.emergency import Emergency
from testbench.procman.boot_gate import BootGate
from testbench.procman.process_manager import ProcessManager
from testbench.ros_bridge import RosBridge
from testbench.ws_manager import WsManager

logger = logging.getLogger("testbench.main")


def build_app(bridge, ws_manager, config, boot_gate, boot_scan, emergency, process_manager) -> FastAPI:
    app = FastAPI(
        title="w_robot_testbench",
        version="0.3.0",
        description="웹 기반 ROS2 로봇 테스트벤치 — 테스트 프로젝트 패러다임.",
    )
    # CORS — 사내망 신뢰(192.168.*) + localhost (bt_gui 계승)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=(
            r"^https?://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+|\[::1\])(:\d+)?$"
        ),
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.state.bridge = bridge
    app.state.ws_manager = ws_manager
    app.state.config = config
    app.state.boot_gate = boot_gate
    app.state.boot_scan = boot_scan
    app.state.emergency = emergency
    app.state.process_manager = process_manager

    app.include_router(system_router)
    app.include_router(boot_router)
    app.include_router(baseline_router)
    app.include_router(emergency_router)
    app.include_router(ws_router)

    @app.get("/")
    async def root() -> dict:
        return {"service": "w_robot_testbench", "version": "0.3.0", "docs": "/docs"}

    @app.get("/api/health")
    async def health() -> dict:
        return {"ok": True, "ros": rclpy.ok()}

    return app


class _RclpyThread(threading.Thread):
    """rclpy executor 를 도는 백그라운드 스레드 (bt_gui 계승)."""

    def __init__(self, executor: SingleThreadedExecutor) -> None:
        super().__init__(daemon=True, name="rclpy-spin")
        self._executor = executor
        self._stop_event = threading.Event()

    def run(self) -> None:
        while not self._stop_event.is_set() and rclpy.ok():
            self._executor.spin_once(timeout_sec=0.1)

    def stop(self) -> None:
        self._stop_event.set()


async def _amain(args: argparse.Namespace) -> int:
    logging.basicConfig(
        level=getattr(logging, args.log_level.upper(), logging.INFO),
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    )
    config = Config()

    rclpy.init(args=None)
    bridge = RosBridge()
    executor = SingleThreadedExecutor()
    executor.add_node(bridge)
    spin_thread = _RclpyThread(executor)
    spin_thread.start()

    try:
        # ── PREBOOT_SCAN — Clean-Slate 게이트 (부속 D §2.5) ──
        process_manager = ProcessManager(config)
        boot_gate = BootGate(config, process_manager)
        boot_scan = boot_gate.scan()
        found = len(boot_scan.get("server", [])) + len(boot_scan.get("controller", []))
        if found:
            logger.warning(
                "관리되지 않는 ROS 프로세스 %d개 감지 → /api/boot/resolve 로 처리 필요 "
                "(server=%d, controller=%d)",
                found, len(boot_scan["server"]), len(boot_scan["controller"]),
            )
        else:
            logger.info("Clean-Slate: 기존 ROS 프로세스 없음")

        ws_manager = WsManager()
        ws_manager.bind_loop(asyncio.get_running_loop())
        ws_manager.update_snapshot(boot_state=boot_scan)
        emergency = Emergency(bridge)

        app = build_app(bridge, ws_manager, config, boot_gate, boot_scan, emergency,
                        process_manager)

        host = config.server.get("host", "0.0.0.0")
        port = int(config.server.get("port", 8080))

        import uvicorn
        server = uvicorn.Server(uvicorn.Config(
            app, host=host, port=port, log_level=args.log_level.lower(), access_log=False,
        ))
        loop = asyncio.get_running_loop()
        for sig in (signal.SIGINT, signal.SIGTERM):
            with contextlib.suppress(NotImplementedError):
                loop.add_signal_handler(sig, lambda: setattr(server, "should_exit", True))

        logger.info("testbench serving http://%s:%d (docs: /docs)", host, port)
        await server.serve()
        return 0
    finally:
        spin_thread.stop()
        spin_thread.join(timeout=2.0)
        executor.shutdown()
        bridge.destroy_node()
        with contextlib.suppress(Exception):
            rclpy.shutdown()


def main() -> int:
    p = argparse.ArgumentParser(prog="testbench")
    p.add_argument("--log-level", default="info")
    args = p.parse_args()
    try:
        return asyncio.run(_amain(args))
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    sys.exit(main())
