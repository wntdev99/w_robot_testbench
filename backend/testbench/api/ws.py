# Copyright 2026 WATT — Apache-2.0
"""WebSocket /api/ws — broadcast 버스 (bt_web_bridge 계승)."""
from __future__ import annotations

import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/api/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    ws_manager = websocket.app.state.ws_manager
    await ws_manager.connect(websocket)
    try:
        while True:
            await websocket.receive_text()  # one-way: 수신 프레임 무시
    except WebSocketDisconnect:
        pass
    except Exception as e:  # pragma: no cover
        logger.warning("ws receive loop error: %s", e)
    finally:
        ws_manager.disconnect(websocket)
