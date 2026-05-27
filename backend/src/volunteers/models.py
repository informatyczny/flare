from sqlalchemy import ForeignKey, Integer, Text
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column, relationship


class Base(DeclarativeBase):
    pass


class Volunteer(Base):
    __tablename__ = "volunteers"
    pubkey: Mapped[str] = mapped_column(Text, primary_key=True)
    status: Mapped[str] = mapped_column(Text, nullable=False, default="active")
    display_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    invited_by: Mapped[str | None] = mapped_column(
        Text, ForeignKey("volunteers.pubkey"), nullable=True
    )
    secret: Mapped[str] = mapped_column(Text, nullable=False, unique=True)
    registered_at: Mapped[str] = mapped_column(Text, nullable=False)

    invitees: Mapped[list["Volunteer"]] = relationship(
        "Volunteer", foreign_keys=[invited_by]
    )
    tokens: Mapped[list["InviteToken"]] = relationship(
        "InviteToken", back_populates="issuer"
    )


class Admin(Base):
    __tablename__ = "admins"
    # Admin pubkey must also exist in the volunteers table (enforced by seed script).
    pubkey: Mapped[str] = mapped_column(
        Text, ForeignKey("volunteers.pubkey"), primary_key=True
    )
    added_at: Mapped[str] = mapped_column(Text, nullable=False)

    volunteer: Mapped["Volunteer"] = relationship("Volunteer")


class InviteToken(Base):
    __tablename__ = "invite_tokens"
    token: Mapped[str] = mapped_column(Text, primary_key=True)
    issued_by: Mapped[str] = mapped_column(
        Text, ForeignKey("volunteers.pubkey"), nullable=False
    )
    used: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[str] = mapped_column(Text, nullable=False)

    issuer: Mapped["Volunteer"] = relationship("Volunteer", back_populates="tokens")
