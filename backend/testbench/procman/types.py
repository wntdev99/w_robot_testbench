"""프로세스 레코드 타입."""
from __future__ import annotations

import time
from dataclasses import dataclass, field
from enum import Enum


class ProcState(str, Enum):
    PENDING = "pending"
    STARTING = "starting"
    RUNNING = "running"
    STOPPING = "stopping"
    STOPPED = "stopped"
    FAILED = "failed"
    EXTERNAL = "external"   # 이미 외부에서 떠 있던 것 (skip_if_running)


@dataclass
class ProcRecord:
    id: str                       # "<profile>:<proc>" 고유 키
    profile_id: str
    proc_id: str
    machine: str                  # "server" | "controller"
    kind: str                     # "launch" | "node" | "zenoh"
    command: str
    state: ProcState = ProcState.PENDING
    pid: int | None = None        # 로컬 PID (원격은 None)
    started_at: float | None = None
    message: str = ""
    # provenance: 이 테스트벤치 실행이 직접 띄웠는지 (종료 정리 대상)
    owned: bool = True

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "profile_id": self.profile_id,
            "proc_id": self.proc_id,
            "machine": self.machine,
            "kind": self.kind,
            "command": self.command,
            "state": self.state.value,
            "pid": self.pid,
            "started_at": self.started_at,
            "uptime_s": (time.time() - self.started_at) if self.started_at else None,
            "message": self.message,
            "owned": self.owned,
        }
