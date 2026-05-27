from sqlalchemy.orm import Session

from config import settings
from volunteers.models import VolunteerStatus
from volunteers.repository import (
    get_queued_events,
    get_volunteer,
    is_event_published,
    queue_event,
)


def should_auto_approve(db: Session, facebook_id: str) -> bool:
    event = next(
        (e for e in get_queued_events(db) if e.facebook_id == facebook_id), None
    )
    return event is not None and event.consensus_count >= settings.CONSENSUS_THRESHOLD


def handle_event_submission(
    db: Session,
    facebook_id: str,
    volunteer_pubkey: str,
    event_data: str,
) -> dict:
    volunteer = get_volunteer(db, volunteer_pubkey)

    if not volunteer:
        return {"status": "rejected", "reason": "unknown_volunteer"}

    if volunteer.status == VolunteerStatus.BANNED:
        return {"status": "rejected", "reason": "banned"}

    if is_event_published(db, facebook_id):
        return {"status": "duplicate"}

    is_trusted = volunteer.status == VolunteerStatus.TRUSTED
    queue_event(db, facebook_id, volunteer_pubkey, event_data, is_trusted=is_trusted)

    if volunteer.status == VolunteerStatus.PROBATION:
        return {"status": "queued", "reason": "probation"}

    if should_auto_approve(db, facebook_id):
        return {"status": "auto_approved"}

    return {"status": "queued"}
