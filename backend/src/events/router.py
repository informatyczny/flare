import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from database import get_db
from lib.loggers import api_logger
from nostr import publish_event
from volunteers.repository import is_event_published, mark_event_published
from volunteers.signatures import verify_signature
from volunteers.trust import handle_event_submission, should_auto_approve

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
    volunteer_pubkey: str
    signature: str


@router.post("/")
async def receive_event(payload: EventPayload, db: Session = Depends(get_db)) -> dict:
    payload_dict = payload.model_dump()

    if not verify_signature(payload_dict, payload.signature, payload.volunteer_pubkey):
        api_logger.warning(
            "Invalid signature for event facebook_id=%s volunteer=%s",
            payload.facebook_id,
            payload.volunteer_pubkey,
        )
        raise HTTPException(status_code=401, detail="Invalid signature")

    if is_event_published(db, payload.facebook_id):
        return {"status": "duplicate"}

    event_data = json.dumps(
        {
            "facebook_id": payload.facebook_id,
            "title": payload.title,
            "start": payload.start,
            "end": payload.end,
            "description": payload.description,
            "location": payload.location,
            "cover_url": payload.cover_url,
            "source_url": payload.source_url,
            "city": payload.city,
        }
    )

    result = handle_event_submission(
        db,
        payload.facebook_id,
        payload.volunteer_pubkey,
        event_data,
    )

    if result["status"] == "rejected":
        api_logger.info(
            "Event rejected facebook_id=%s reason=%s",
            payload.facebook_id,
            result.get("reason"),
        )
        return result

    if result["status"] == "duplicate":
        return result

    if result["status"] in ("queued", "auto_approved"):
        if result["status"] == "auto_approved" or should_auto_approve(
            db, payload.facebook_id
        ):
            try:
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
                mark_event_published(
                    db, payload.facebook_id, payload.volunteer_pubkey, nostr_id
                )
                api_logger.info(
                    "Event published via consensus facebook_id=%s", payload.facebook_id
                )
                return {"status": "published", "nostr_id": nostr_id}
            except Exception as e:
                api_logger.error(
                    "Failed to publish event facebook_id=%s: %s", payload.facebook_id, e
                )
                return {"status": "queued"}

        api_logger.info(
            "Event queued facebook_id=%s volunteer=%s",
            payload.facebook_id,
            payload.volunteer_pubkey,
        )
        return {"status": "queued"}

    return {"status": "queued"}
