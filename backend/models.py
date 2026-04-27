"""数据模型：Trip 是一本路书，既兼容旧的点位，也保存新的行政区与行程 JSON。"""
from datetime import datetime
from typing import Optional, List
from sqlmodel import SQLModel, Field, Relationship


class Trip(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    name: str = Field(default="未命名路书")
    description: str = Field(default="")
    regions_json: str = Field(default="[]")
    itinerary_json: str = Field(default="[]")
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)

    points: List["Point"] = Relationship(
        back_populates="trip",
        sa_relationship_kwargs={"cascade": "all, delete-orphan", "order_by": "Point.order_index"},
    )


class Point(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    trip_id: int = Field(foreign_key="trip.id")
    lng: float
    lat: float
    title: str = Field(default="")
    note: str = Field(default="")
    order_index: int = Field(default=0)

    trip: Optional[Trip] = Relationship(back_populates="points")
