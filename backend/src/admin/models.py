from datetime import datetime, timezone

from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from database import Base


class AdminORM(Base):
    __tablename__ = "admins"

    pubkey: Mapped[str] = mapped_column(String, primary_key=True, index=True)
    added_at: Mapped[datetime] = mapped_column(default=datetime.now(timezone.utc), nullable=False)
