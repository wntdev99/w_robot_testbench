"""녹화 API — 세션 start/stop, 목록, CSV 다운로드."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel

from ..recorder import REC_DIR

router = APIRouter(prefix="/api/recordings", tags=["recordings"])


class StartBody(BaseModel):
    name: str = ""
    topics: list[dict] = []          # [{topic, msgType}]
    diagnostics: bool = False
    system: bool = False


@router.post("/start")
async def start(body: StartBody, request: Request):
    return request.app.state.ctx.recorder.start(body.name, body.topics, body.diagnostics, body.system)


class StopBody(BaseModel):
    id: str


@router.post("/stop")
async def stop(body: StopBody, request: Request):
    return request.app.state.ctx.recorder.stop(body.id)


@router.get("/active")
async def active(request: Request):
    return request.app.state.ctx.recorder.active()


@router.get("")
async def list_recordings(request: Request):
    return request.app.state.ctx.recorder.list_recordings()


@router.get("/{filename}/download")
async def download(filename: str):
    # 경로 traversal 방지: 파일명만 허용
    if "/" in filename or ".." in filename:
        raise HTTPException(400, "잘못된 파일명")
    path = REC_DIR / filename
    if not path.is_file():
        raise HTTPException(404, "녹화 파일 없음")
    return FileResponse(str(path), media_type="text/csv", filename=filename)
