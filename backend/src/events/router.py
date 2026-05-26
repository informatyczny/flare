
from fastapi import APIRouter
from pydantic import BaseModel

from config import settings
from events.utils import is_duplicate
from nostr import publish_event

router = APIRouter()


class EventPayload(BaseModel):
    facebook_id: str
    title: str
    start: int
    end: int | None = None
    description: str | None = None
    location: str | None = None
    cover_url: str | None = None
    source_url: str
    city: str | None = None


@router.post("/api/events")
async def receive_event(payload: EventPayload) -> dict:
    if is_duplicate(payload.facebook_id):
        return {"status": "duplicate"}

    nostr_id = await publish_event(
        facebook_id=payload.facebook_id,
        title=payload.title,
        start=payload.start,
        end=payload.end,
        description=payload.description,
        location=payload.location,
        cover_url=payload.cover_url,
        source_url=payload.source_url,
        city=payload.city,
    )
    return {"status": "published", "nostr_id": nostr_id}


@router.get("/api/health")
async def health() -> dict:
    return {"status": "ok", "relays": settings.NOSTR_RELAYS}
