"""WebSocket 엔드포인트 — 동적 구독 제어 + 이벤트 스트림.

클라이언트 메시지:
  {"op":"sub","topic":"/joint_states","type":"sensor_msgs/msg/JointState"}
  {"op":"unsub","topic":"/joint_states"}
서버 이벤트(broadcast): welcome / topic_data / diagnostics / processes / system / estop
"""
from __future__ import annotations

import json
import logging

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger("testbench.api.ws")
router = APIRouter()


@router.websocket("/ws")
async def ws_endpoint(ws: WebSocket):
    ctx = ws.app.state.ctx
    await ctx.ws.connect(ws)
    my_topics: set[str] = set()
    try:
        while True:
            raw = await ws.receive_text()
            try:
                msg = json.loads(raw)
            except json.JSONDecodeError:
                continue
            op = msg.get("op")
            topic = msg.get("topic")
            if op == "sub" and topic:
                if ctx.stream.subscribe(topic, msg.get("type")):
                    my_topics.add(topic)
            elif op == "unsub" and topic:
                ctx.stream.unsubscribe(topic)
                my_topics.discard(topic)
    except WebSocketDisconnect:
        pass
    finally:
        for t in my_topics:
            ctx.stream.unsubscribe(t)
        ctx.ws.disconnect(ws)
