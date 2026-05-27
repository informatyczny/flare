import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from admin.auth import require_admin
from database import get_db
from lib.loggers import api_logger
from nostr import publish_event
from volunteers.models import QueuedEventSchema, VolunteerStatus
from volunteers.repository import (
    approve_queued_event,
    get_all_volunteers,
    get_queued_events,
    mark_event_published,
    reject_queued_event,
    set_volunteer_status,
)

router = APIRouter()


@router.get("/check")
def check_admin(pubkey: str, db: Session = Depends(get_db)) -> dict:
    from admin.models import AdminORM

    is_admin = db.query(AdminORM).filter(AdminORM.pubkey == pubkey).first() is not None
    return {"is_admin": is_admin}


@router.get("/volunteers")
def list_volunteers(
    db: Session = Depends(get_db),
    _admin: str = Depends(require_admin),
) -> dict:
    return {"volunteers": get_all_volunteers(db)}


class StatusUpdate(BaseModel):
    status: VolunteerStatus


@router.post("/volunteers/{pubkey}/status")
def update_volunteer_status(
    pubkey: str,
    body: StatusUpdate,
    db: Session = Depends(get_db),
    _admin: str = Depends(require_admin),
) -> dict:
    if not set_volunteer_status(db, pubkey, body.status):
        raise HTTPException(status_code=404, detail="Volunteer not found")
    api_logger.info("Volunteer status updated pubkey=%s status=%s", pubkey, body.status)
    return {"status": body.status}


@router.get("/queue")
async def get_queue(
    db: Session = Depends(get_db),
    _admin: str = Depends(require_admin),
) -> dict:
    events = get_queued_events(db)
    return {
        "events": [QueuedEventSchema.model_validate(e).model_dump() for e in events]
    }


@router.post("/queue/{facebook_id}/approve")
async def approve_event(
    facebook_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(require_admin),
) -> dict:
    result = approve_queued_event(db, facebook_id)
    if not result:
        raise HTTPException(status_code=404, detail="Event not in queue")

    try:
        event_data = json.loads(result["event_data"])
        nostr_id = await publish_event(
            facebook_id=event_data["facebook_id"],
            title=event_data["title"],
            start=event_data["start"],
            end=event_data.get("end"),
            description=event_data.get("description"),
            location=event_data.get("location"),
            cover_url=event_data.get("cover_url"),
            source_url=event_data["source_url"],
            city=event_data.get("city"),
        )
        mark_event_published(db, facebook_id, result["volunteer_pubkey"], nostr_id)
        api_logger.info("Event approved and published facebook_id=%s", facebook_id)
        return {"status": "approved", "nostr_id": nostr_id}
    except Exception as e:
        api_logger.error(
            "Failed to publish approved event facebook_id=%s: %s", facebook_id, e
        )
        raise HTTPException(status_code=500, detail="Failed to publish event")


@router.post("/queue/{facebook_id}/reject")
async def reject_event(
    facebook_id: str,
    db: Session = Depends(get_db),
    _admin: str = Depends(require_admin),
) -> dict:
    if not reject_queued_event(db, facebook_id):
        raise HTTPException(status_code=404, detail="Event not in queue")

    api_logger.info("Event rejected facebook_id=%s", facebook_id)
    return {"status": "rejected"}
