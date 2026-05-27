import enum
from datetime import datetime, timezone

from pydantic import BaseModel
from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from database import Base


class VolunteerStatus(str, enum.Enum):
    PROBATION = "probation"
    TRUSTED = "trusted"
    BANNED = "banned"


class VolunteerORM(Base):
    __tablename__ = "volunteers"

    pubkey: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    nickname: Mapped[str] = mapped_column(String, nullable=False)
    status: Mapped[VolunteerStatus] = mapped_column(
        Enum(VolunteerStatus), default=VolunteerStatus.PROBATION, nullable=False
    )
    approval_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
        nullable=False,
    )

    invite_tokens: Mapped[list["InviteTokenORM"]] = relationship(
        "InviteTokenORM", back_populates="issuer"
    )
    queued_events: Mapped[list["QueuedEventORM"]] = relationship(
        "QueuedEventORM", back_populates="volunteer"
    )
    published_events: Mapped[list["PublishedEventORM"]] = relationship(
        "PublishedEventORM", back_populates="volunteer"
    )


class InviteTokenORM(Base):
    __tablename__ = "invite_tokens"

    token: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    issuer_pubkey: Mapped[str] = mapped_column(
        String, ForeignKey("volunteers.pubkey"), nullable=False
    )
    used: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(default=datetime.now(timezone.utc), nullable=False)
    used_by_pubkey: Mapped[str | None] = mapped_column(String, nullable=True)
    used_at: Mapped[datetime | None] = mapped_column(nullable=True)

    issuer: Mapped["VolunteerORM"] = relationship("VolunteerORM", back_populates="invite_tokens")


class QueuedEventORM(Base):
    __tablename__ = "queued_events"

    facebook_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    volunteer_pubkey: Mapped[str] = mapped_column(
        String, ForeignKey("volunteers.pubkey"), nullable=False
    )
    event_data: Mapped[str] = mapped_column(String, nullable=False)
    consensus_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    # JSON list of all pubkeys that have submitted this event (prevents double-counting).
    contributors: Mapped[str] = mapped_column(String, nullable=False, default="[]")
    created_at: Mapped[datetime] = mapped_column(default=datetime.now(timezone.utc), nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        default=datetime.now(timezone.utc),
        onupdate=datetime.now(timezone.utc),
        nullable=False,
    )

    volunteer: Mapped["VolunteerORM"] = relationship("VolunteerORM", back_populates="queued_events")


class PublishedEventORM(Base):
    __tablename__ = "published_events"

    facebook_id: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    volunteer_pubkey: Mapped[str] = mapped_column(
        String, ForeignKey("volunteers.pubkey"), nullable=False
    )
    nostr_id: Mapped[str] = mapped_column(String, nullable=False, index=True)
    published_at: Mapped[datetime] = mapped_column(
        default=datetime.now(timezone.utc), nullable=False
    )

    volunteer: Mapped["VolunteerORM"] = relationship(
        "VolunteerORM", back_populates="published_events"
    )


class VolunteerSchema(BaseModel):
    pubkey: str
    nickname: str
    status: VolunteerStatus
    approval_count: int

    model_config = {"from_attributes": True}


class RegisterRequest(BaseModel):
    pubkey: str
    invite_token: str
    nickname: str


class InviteRequest(BaseModel):
    pubkey: str
    signature: str


class QueuedEventSchema(BaseModel):
    facebook_id: str
    volunteer_pubkey: str
    event_data: str
    consensus_count: int

    model_config = {"from_attributes": True}
