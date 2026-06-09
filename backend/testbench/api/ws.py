# Copyright 2026 WATT — Apache-2.0
"""WebSocket /api/ws — broadcast 버스 (bt_web_bridge 계승)."""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter()


@router.websocket("/api/ws")
async def ws_endpoint(websocket: WebSocket) -> None:
    ws_manager = websocket.app.state.ws_manager
    pool = websocket.app.state.subscriber_pool
    await ws_manager.connect(websocket)
    try:
        while True:
            text = await websocket.receive_text()
            # 동적 구독 제어: {op:"sub"|"unsub", topic} (DESIGN §7.2)
            try:
                msg = json.loads(text)
            except Exception:
                continue
            op, topic = msg.get("op"), msg.get("topic")
            if op == "sub" and topic:
                await ws_manager.broadcast("sub_ack", pool.subscribe(topic))
            elif op == "unsub" and topic:
                pool.unsubscribe(topic)
    except WebSocketDisconnect:
        pass
    except Exception as e:  # pragma: no cover
        logger.warning("ws receive loop error: %s", e)
    finally:
        ws_manager.disconnect(websocket)
