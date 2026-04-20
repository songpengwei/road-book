"""FastAPI 主入口：提供 REST API + 静态前端文件。"""
from __future__ import annotations
import json
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, Depends, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, Response
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from sqlmodel import Session, select

from db import engine, init_db, get_session, DATA_DIR
import models
from render import render_overlay

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"
UPLOAD_DIR = DATA_DIR / "uploads"

app = FastAPI(title="Road Book API", version="0.1.0")


@app.on_event("startup")
def on_startup():
    # 直接在这里注册表（避开 db.init_db 里的 relative import）
    from sqlmodel import SQLModel
    SQLModel.metadata.create_all(engine)


# ---------- Schemas ----------

class PointIn(BaseModel):
    lng: float
    lat: float
    title: str = ""
    note: str = ""


class PointOut(PointIn):
    id: int
    order_index: int


class TripIn(BaseModel):
    name: str = "未命名路书"
    description: str = ""


class TripPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None


class TripOut(BaseModel):
    id: int
    name: str
    description: str
    created_at: datetime
    updated_at: datetime
    points: List[PointOut] = []


class ReorderIn(BaseModel):
    point_ids: List[int]


# ---------- Helpers ----------

def _point_out(p: models.Point) -> PointOut:
    return PointOut(
        id=p.id, lng=p.lng, lat=p.lat, title=p.title, note=p.note, order_index=p.order_index,
    )


def _trip_out(t: models.Trip) -> TripOut:
    return TripOut(
        id=t.id,
        name=t.name,
        description=t.description,
        created_at=t.created_at,
        updated_at=t.updated_at,
        points=[_point_out(p) for p in sorted(t.points, key=lambda x: x.order_index)],
    )


def _touch(t: models.Trip):
    t.updated_at = datetime.utcnow()


# ---------- Trip APIs ----------

@app.get("/api/trips", response_model=List[TripOut])
def list_trips(session: Session = Depends(get_session)):
    trips = session.exec(select(models.Trip).order_by(models.Trip.updated_at.desc())).all()
    return [_trip_out(t) for t in trips]


@app.post("/api/trips", response_model=TripOut)
def create_trip(body: TripIn, session: Session = Depends(get_session)):
    t = models.Trip(name=body.name, description=body.description)
    session.add(t)
    session.commit()
    session.refresh(t)
    return _trip_out(t)


@app.get("/api/trips/{trip_id}", response_model=TripOut)
def get_trip(trip_id: int, session: Session = Depends(get_session)):
    t = session.get(models.Trip, trip_id)
    if not t:
        raise HTTPException(404, "trip not found")
    return _trip_out(t)


@app.patch("/api/trips/{trip_id}", response_model=TripOut)
def patch_trip(trip_id: int, body: TripPatch, session: Session = Depends(get_session)):
    t = session.get(models.Trip, trip_id)
    if not t:
        raise HTTPException(404)
    if body.name is not None:
        t.name = body.name
    if body.description is not None:
        t.description = body.description
    _touch(t)
    session.add(t)
    session.commit()
    session.refresh(t)
    return _trip_out(t)


@app.delete("/api/trips/{trip_id}")
def delete_trip(trip_id: int, session: Session = Depends(get_session)):
    t = session.get(models.Trip, trip_id)
    if not t:
        raise HTTPException(404)
    session.delete(t)
    session.commit()
    return {"ok": True}


# ---------- Point APIs ----------

@app.post("/api/trips/{trip_id}/points", response_model=PointOut)
def add_point(trip_id: int, body: PointIn, session: Session = Depends(get_session)):
    t = session.get(models.Trip, trip_id)
    if not t:
        raise HTTPException(404)
    max_order = max([p.order_index for p in t.points], default=-1)
    p = models.Point(
        trip_id=trip_id, lng=body.lng, lat=body.lat,
        title=body.title, note=body.note, order_index=max_order + 1,
    )
    session.add(p)
    _touch(t)
    session.commit()
    session.refresh(p)
    return _point_out(p)


@app.patch("/api/points/{point_id}", response_model=PointOut)
def patch_point(point_id: int, body: PointIn, session: Session = Depends(get_session)):
    p = session.get(models.Point, point_id)
    if not p:
        raise HTTPException(404)
    p.lng = body.lng
    p.lat = body.lat
    p.title = body.title
    p.note = body.note
    t = session.get(models.Trip, p.trip_id)
    if t:
        _touch(t)
    session.add(p)
    session.commit()
    session.refresh(p)
    return _point_out(p)


@app.delete("/api/points/{point_id}")
def delete_point(point_id: int, session: Session = Depends(get_session)):
    p = session.get(models.Point, point_id)
    if not p:
        raise HTTPException(404)
    trip_id = p.trip_id
    session.delete(p)
    t = session.get(models.Trip, trip_id)
    if t:
        _touch(t)
    session.commit()
    return {"ok": True}


@app.post("/api/trips/{trip_id}/reorder")
def reorder_points(trip_id: int, body: ReorderIn, session: Session = Depends(get_session)):
    t = session.get(models.Trip, trip_id)
    if not t:
        raise HTTPException(404)
    id_to_point = {p.id: p for p in t.points}
    for new_idx, pid in enumerate(body.point_ids):
        if pid in id_to_point:
            id_to_point[pid].order_index = new_idx
            session.add(id_to_point[pid])
    _touch(t)
    session.commit()
    return {"ok": True}


# ---------- Export ----------

@app.post("/api/trips/{trip_id}/export")
async def export_trip(
    trip_id: int,
    image: UploadFile = File(...),
    control_points: str = Form(...),   # JSON 字符串：[{"x":..,"y":..,"lng":..,"lat":..}, ...]
    show_track: bool = Form(True),
    session: Session = Depends(get_session),
):
    t = session.get(models.Trip, trip_id)
    if not t:
        raise HTTPException(404)

    try:
        cps = json.loads(control_points)
        assert isinstance(cps, list) and len(cps) >= 2
    except Exception:
        raise HTTPException(400, "control_points 必须是 JSON 数组，至少 2 项")

    # 存盘，顺便留个备份
    ts = datetime.utcnow().strftime("%Y%m%d_%H%M%S")
    saved = UPLOAD_DIR / f"trip{trip_id}_{ts}_{image.filename}"
    content = await image.read()
    saved.write_bytes(content)

    pts = [
        {"lng": p.lng, "lat": p.lat, "title": p.title, "order_index": p.order_index}
        for p in sorted(t.points, key=lambda x: x.order_index)
    ]

    try:
        png_bytes = render_overlay(
            image_path=saved,
            control_points=cps,
            points=pts,
            show_track=show_track,
        )
    except Exception as e:
        raise HTTPException(500, f"渲染失败：{e}")

    from urllib.parse import quote
    fname = f"{t.name}_{ts}.png"
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={"Content-Disposition": f"attachment; filename*=UTF-8''{quote(fname)}"},
    )


# ---------- Static Frontend ----------

@app.get("/")
def index():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/edit")
def edit_page():
    return FileResponse(FRONTEND_DIR / "edit.html")


@app.get("/export")
def export_page():
    return FileResponse(FRONTEND_DIR / "export.html")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=True)
