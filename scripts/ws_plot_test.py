#!/usr/bin/env python3
# WS plot 수신 검증 — /api/ws 구독 후 토픽 스트림 카운트 (P1 plot 검증).
import asyncio
import json

import websockets


async def main():
    got = {}
    async with websockets.connect("ws://localhost:8080/api/ws") as ws:
        await ws.send(json.dumps({"op": "sub", "topic": "/joint_states"}))
        await ws.send(json.dumps({"op": "sub", "topic": "/diagnostics"}))
        try:
            for _ in range(40):
                m = json.loads(await asyncio.wait_for(ws.recv(), timeout=6))
                if m.get("type") == "topic":
                    t = m["data"]["topic"]
                    got[t] = got.get(t, 0) + 1
                    if got.get("/joint_states", 0) >= 2 and got.get("/diagnostics", 0) >= 2:
                        break
                elif m.get("type") == "sub_ack":
                    print("sub_ack:", m["data"])
        except asyncio.TimeoutError:
            print("(recv timeout)")
    print("WS plot 수신 카운트:", dict(got))


asyncio.run(main())
