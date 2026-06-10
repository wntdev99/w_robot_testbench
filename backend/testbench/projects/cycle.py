# Copyright 2026 WATT — Apache-2.0
"""cycle 러너 — 반복 내구성 (부속 D §2-E, 역량 E).

runner.mode=cycle: steps(control 위젯 id 참조) × count 반복, settle_s 대기,
stop_on(토픽 bool) 안전중단, E-stop 시 즉시 중단·부분결과 보존(부속 D §4.1).
1차: step = control.topic_pub 위젯(publish). service/action step은 후속.
"""
from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)


class CycleRunner:
    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()
        self.state: dict = {"running": False, "count": 0, "target": 0}

    @property
    def running(self) -> bool:
        return self._task is not None and not self._task.done()

    async def start(self, project: dict, publisher_pool, bridge, ws, recorder) -> dict:
        if self.running:
            return {"error": "cycle_already_running"}
        runner = project.get("runner", {})
        cyc = runner.get("cycle", {})
        widgets = {w["id"]: w for w in project.get("layout", {}).get("widgets", [])}
        steps = cyc.get("steps", [])
        # step 해석: {call: <widget_id>, values?, settle_s?} → publish 동작
        resolved = []
        for s in steps:
            w = widgets.get(s.get("call"))
            if not w or w.get("kind") != "control.topic_pub":
                return {"error": f"step 위젯 불가: {s.get('call')} (control.topic_pub만 지원)"}
            resolved.append({"topic": w["name"], "type": w["type"],
                             "values": s.get("values", {}), "settle_s": float(s.get("settle_s", 1.0))})
        count = int(cyc.get("count", 1))
        stop_on = cyc.get("stop_on")  # {sensor: topic, equals: true} — 후속(센서 구독 연계)

        self._stop.clear()
        self.state = {"running": True, "count": 0, "target": count, "project": project.get("id")}

        async def _loop() -> None:
            try:
                for i in range(count):
                    if self._stop.is_set():
                        break
                    for st in resolved:
                        if self._stop.is_set():
                            break
                        publisher_pool.publish(st["topic"], st["type"], st["values"])
                        await asyncio.sleep(st["settle_s"])
                    self.state["count"] = i + 1
                    recorder.set_counter("cycle_count", i + 1) if recorder.active else None
                    await ws.broadcast("cycle_progress", {"count": i + 1, "target": count})
            finally:
                self.state["running"] = False
                await ws.broadcast("cycle_done", dict(self.state))
                logger.info("cycle 종료 %s/%s", self.state["count"], count)

        self._task = asyncio.get_running_loop().create_task(_loop())
        return {"started": True, "target": count, "steps": len(resolved), "stop_on": stop_on}

    async def stop(self) -> dict:
        """수동/E-stop 중단 — 카운터·기록은 보존(부분결과)."""
        self._stop.set()
        if self._task:
            try:
                await asyncio.wait_for(self._task, timeout=10)
            except asyncio.TimeoutError:
                self._task.cancel()
        return dict(self.state)
