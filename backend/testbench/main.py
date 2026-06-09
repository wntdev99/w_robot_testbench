"""w_robot_testbench 백엔드 진입점.

부팅 순서:
  1. config 로드
  2. rclpy.init() + RosBridge spin 스레드
  3. WsManager 루프 바인딩, Orchestrator, StreamHub 구성
  4. 백그라운드 태스크: 시스템 모니터 / 201 연결성 폴링
  5. (옵션) 자동 순차기동 — env TESTBENCH_AUTOSTART=1 일 때만 (모터 인가 주의)
  6. FastAPI 라우터 + 프론트 정적 서빙
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import logging
import os
from pathlib import Path

import rclpy
import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .config import load_config
from .context import Context
from .procman.orchestrator import Orchestrator
from .ros.stream import StreamHub
from .ros_bridge import RosBridge
from .ws_manager import WsManager
from .api import emergency, profiles, system, topics, ws as ws_api

logging.basicConfig(level=logging.INFO,
                    format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger("testbench.main")

FRONTEND_DIST = Path(__file__).resolve().parents[2] / "frontend" / "out"


async def _monitor_loop(app: FastAPI) -> None:
    from .monitor import local_stats
    ctx: Context = app.state.ctx
    while True:
        try:
            stats = await local_stats.snapshot(
                controller_reachable=ctx.controller_reachable,
                controller_host=ctx.cfg.controller.host if ctx.cfg.controller else None,
            )
            stats["zenoh"] = ctx.orch.zenoh.status()
            await ctx.ws.broadcast("system", stats, snapshot=True)
        except Exception:  # noqa: BLE001
            logger.exception("monitor loop")
        await asyncio.sleep(2.0)


async def _liveness_loop(app: FastAPI) -> None:
    ctx: Context = app.state.ctx
    interval = float((ctx.cfg.raw.get("liveness", {})
                      .get("controller_machine", {}).get("interval_s", 5)))
    while True:
        if ctx.orch.remote:
            try:
                ctx.controller_reachable = await ctx.orch.remote.reachable()
            except Exception:  # noqa: BLE001
                ctx.controller_reachable = False
        await asyncio.sleep(interval)


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    cfg = load_config()
    rclpy.init()
    ros = RosBridge()
    ros.start()
    ws = WsManager()
    ws.bind_loop(asyncio.get_running_loop())
    orch = Orchestrator(cfg, ros, ws)
    stream = StreamHub(ros, ws, float(cfg.streaming.get("default_rate_hz", 20)))
    app.state.ctx = Context(cfg=cfg, ros=ros, ws=ws, orch=orch, stream=stream)

    tasks = [asyncio.create_task(_monitor_loop(app)),
             asyncio.create_task(_liveness_loop(app))]

    if os.environ.get("TESTBENCH_AUTOSTART") == "1":
        logger.info("TESTBENCH_AUTOSTART=1 → 자동 순차기동")
        asyncio.create_task(orch.autostart())
    else:
        logger.info("자동기동 비활성(기본). UI 또는 TESTBENCH_AUTOSTART=1 로 기동.")

    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await orch.shutdown()
        ros.shutdown()
        with contextlib.suppress(Exception):
            rclpy.shutdown()


def build_app() -> FastAPI:
    app = FastAPI(title="w_robot_testbench", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origin_regex=r"http://(localhost|127\.0\.0\.1|192\.168\.\d+\.\d+)(:\d+)?",
        allow_methods=["*"], allow_headers=["*"], allow_credentials=True,
    )
    for r in (system.router, profiles.router, topics.router, emergency.router, ws_api.router):
        app.include_router(r)

    @app.get("/api/health")
    async def health():
        return {"ok": True, "version": "0.1.0"}

    if FRONTEND_DIST.is_dir():
        app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")
        logger.info("프론트 정적 서빙: %s", FRONTEND_DIST)
    return app


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    args = parser.parse_args()
    cfg = load_config()
    uvicorn.run(
        "testbench.main:build_app",
        factory=True,
        host=args.host or cfg.server_host,
        port=args.port or cfg.server_port,
    )


if __name__ == "__main__":
    main()
