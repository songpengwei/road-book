"""FastAPI 主入口：提供 REST API + 静态前端文件。"""
from __future__ import annotations

import json
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import List, Optional

from fastapi import Depends, FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sqlmodel import Session, SQLModel, select

from db import DB_PATH, engine, get_session
from geo import load_boundary, load_province_boundaries, search_regions
import models

BASE_DIR = Path(__file__).resolve().parent.parent
FRONTEND_DIR = BASE_DIR / "frontend"

app = FastAPI(title="Road Book API", version="0.2.0")


def _ensure_trip_columns():
    conn = sqlite3.connect(DB_PATH)
    cur = conn.cursor()
    cur.execute("PRAGMA table_info(trip)")
    existing = {row[1] for row in cur.fetchall()}
    if "regions_json" not in existing:
        cur.execute("ALTER TABLE trip ADD COLUMN regions_json TEXT NOT NULL DEFAULT '[]'")
    if "itinerary_json" not in existing:
        cur.execute("ALTER TABLE trip ADD COLUMN itinerary_json TEXT NOT NULL DEFAULT '[]'")
    conn.commit()
    conn.close()


@app.on_event("startup")
def on_startup():
    SQLModel.metadata.create_all(engine)
    _ensure_trip_columns()


class PointIn(BaseModel):
    lng: float
    lat: float
    title: str = ""
    note: str = ""


class PointOut(PointIn):
    id: int
    order_index: int


class RegionSelection(BaseModel):
    adcode: str
    name: str
    full_name: str = ""
    level: str = ""
    parents: List[str] = Field(default_factory=list)


class PlaceItem(BaseModel):
    id: str = ""
    title: str = ""
    category: str = "heritage"
    region_adcode: str = ""


class ItineraryItem(BaseModel):
    id: str = ""
    title: str = ""
    time: str = ""
    transport: str = ""
    route_text: str = ""
    accommodation: str = ""
    notes: str = ""
    places: List[PlaceItem] = Field(default_factory=list)


class TripIn(BaseModel):
    name: str = "未命名路书"
    description: str = ""


class TripPatch(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    regions: Optional[List[RegionSelection]] = None
    itinerary: Optional[List[ItineraryItem]] = None


class TripOut(BaseModel):
    id: int
    name: str
    description: str
    created_at: datetime
    updated_at: datetime
    points: List[PointOut] = Field(default_factory=list)
    regions: List[RegionSelection] = Field(default_factory=list)
    itinerary: List[ItineraryItem] = Field(default_factory=list)


class ReorderIn(BaseModel):
    point_ids: List[int]


def _load_json_field(raw: str, default):
    if not raw:
        return default
    try:
        return json.loads(raw)
    except Exception:
        return default


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
        regions=_load_json_field(t.regions_json, []),
        itinerary=_load_json_field(t.itinerary_json, []),
    )


def _touch(t: models.Trip):
    t.updated_at = datetime.utcnow()


@app.get("/api/trips", response_model=List[TripOut])
def list_trips(session: Session = Depends(get_session)):
    trips = session.exec(select(models.Trip).order_by(models.Trip.updated_at.desc())).all()
    return [_trip_out(t) for t in trips]


@app.post("/api/trips", response_model=TripOut)
def create_trip(body: TripIn, session: Session = Depends(get_session)):
    trip = models.Trip(name=body.name, description=body.description)
    session.add(trip)
    session.commit()
    session.refresh(trip)
    return _trip_out(trip)


@app.get("/api/trips/{trip_id}", response_model=TripOut)
def get_trip(trip_id: int, session: Session = Depends(get_session)):
    trip = session.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(404, "trip not found")
    return _trip_out(trip)


@app.patch("/api/trips/{trip_id}", response_model=TripOut)
def patch_trip(trip_id: int, body: TripPatch, session: Session = Depends(get_session)):
    trip = session.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(404, "trip not found")
    if body.name is not None:
        trip.name = body.name
    if body.description is not None:
        trip.description = body.description
    if body.regions is not None:
        trip.regions_json = json.dumps([item.model_dump() for item in body.regions], ensure_ascii=False)
    if body.itinerary is not None:
        trip.itinerary_json = json.dumps([item.model_dump() for item in body.itinerary], ensure_ascii=False)
    _touch(trip)
    session.add(trip)
    session.commit()
    session.refresh(trip)
    return _trip_out(trip)


@app.delete("/api/trips/{trip_id}")
def delete_trip(trip_id: int, session: Session = Depends(get_session)):
    trip = session.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(404, "trip not found")
    session.delete(trip)
    session.commit()
    return {"ok": True}


@app.get("/api/regions")
def region_search(keyword: str):
    return search_regions(keyword)


@app.get("/api/regions/geometry")
def region_geometry(adcodes: str):
    codes = [str(code).strip() for code in adcodes.split(",") if str(code).strip()]
    if not codes:
        return {"type": "FeatureCollection", "features": []}
    features = []
    for code in codes:
        try:
            features.append(load_boundary(code))
        except Exception as exc:
            raise HTTPException(502, f"加载边界失败：{code} ({exc})")
    return {"type": "FeatureCollection", "features": features}


@app.get("/api/map/background")
def map_background():
    return load_province_boundaries()


@app.post("/api/trips/{trip_id}/points", response_model=PointOut)
def add_point(trip_id: int, body: PointIn, session: Session = Depends(get_session)):
    trip = session.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(404, "trip not found")
    max_order = max([p.order_index for p in trip.points], default=-1)
    point = models.Point(
        trip_id=trip_id,
        lng=body.lng,
        lat=body.lat,
        title=body.title,
        note=body.note,
        order_index=max_order + 1,
    )
    session.add(point)
    _touch(trip)
    session.commit()
    session.refresh(point)
    return _point_out(point)


@app.patch("/api/points/{point_id}", response_model=PointOut)
def patch_point(point_id: int, body: PointIn, session: Session = Depends(get_session)):
    point = session.get(models.Point, point_id)
    if not point:
        raise HTTPException(404, "point not found")
    point.lng = body.lng
    point.lat = body.lat
    point.title = body.title
    point.note = body.note
    trip = session.get(models.Trip, point.trip_id)
    if trip:
        _touch(trip)
    session.add(point)
    session.commit()
    session.refresh(point)
    return _point_out(point)


@app.delete("/api/points/{point_id}")
def delete_point(point_id: int, session: Session = Depends(get_session)):
    point = session.get(models.Point, point_id)
    if not point:
        raise HTTPException(404, "point not found")
    trip = session.get(models.Trip, point.trip_id)
    session.delete(point)
    if trip:
        _touch(trip)
    session.commit()
    return {"ok": True}


@app.post("/api/trips/{trip_id}/reorder")
def reorder_points(trip_id: int, body: ReorderIn, session: Session = Depends(get_session)):
    trip = session.get(models.Trip, trip_id)
    if not trip:
        raise HTTPException(404, "trip not found")
    point_map = {p.id: p for p in trip.points}
    for index, point_id in enumerate(body.point_ids):
        if point_id in point_map:
            point_map[point_id].order_index = index
            session.add(point_map[point_id])
    _touch(trip)
    session.commit()
    return {"ok": True}


@app.get("/")
def index_page():
    return FileResponse(FRONTEND_DIR / "index.html")


@app.get("/edit")
def edit_page():
    return FileResponse(FRONTEND_DIR / "edit.html")


@app.get("/export")
def export_page():
    return FileResponse(FRONTEND_DIR / "export.html")


app.mount("/static", StaticFiles(directory=FRONTEND_DIR / "static"), name="static")
