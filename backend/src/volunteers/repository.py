import json
import uuid
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from volunteers.models import (
    InviteTokenORM,
    PublishedEventORM,
    QueuedEventORM,
    VolunteerORM,
    VolunteerStatus,
)


def register_volunteer(db: Session, pubkey: str, nickname: str) -> bool:
    """Returns True if registration successful, False if already exists."""
    existing = db.query(VolunteerORM).filter(VolunteerORM.pubkey == pubkey).first()
    if existing:
        return False

    volunteer = VolunteerORM(pubkey=pubkey, nickname=nickname)
    db.add(volunteer)
    db.commit()
    return True


def get_volunteer(db: Session, pubkey: str) -> VolunteerORM | None:
    return db.query(VolunteerORM).filter(VolunteerORM.pubkey == pubkey).first()


def create_invite_token(db: Session, issuer_pubkey: str) -> str | None:
    """Returns token, or None if issuer doesn't exist or isn't trusted."""
    volunteer = get_volunteer(db, issuer_pubkey)
    if not volunteer or volunteer.status != VolunteerStatus.TRUSTED:
        return None

    outstanding = (
        db.query(InviteTokenORM)
        .filter(
            InviteTokenORM.issuer_pubkey == issuer_pubkey,
            InviteTokenORM.used == False,  # noqa: E712
        )
        .count()
    )
    if outstanding >= 3:
        return None

    token = str(uuid.uuid4())
    invite = InviteTokenORM(token=token, issuer_pubkey=issuer_pubkey)
    db.add(invite)
    db.commit()
    return token


def use_invite_token(db: Session, token: str, new_volunteer_pubkey: str) -> bool:
    """Mark token as used and return True if successful."""
    invite = db.query(InviteTokenORM).filter(InviteTokenORM.token == token).first()

    if not invite or invite.used:
        return False

    invite.used = True
    invite.used_by_pubkey = new_volunteer_pubkey
    invite.used_at = datetime.now(timezone.utc)
    db.commit()
    return True


def mark_event_published(
    db: Session, facebook_id: str, volunteer_pubkey: str, nostr_id: str
) -> None:
    existing = (
        db.query(PublishedEventORM)
        .filter(PublishedEventORM.facebook_id == facebook_id)
        .first()
    )

    if existing:
        existing.nostr_id = nostr_id
    else:
        event = PublishedEventORM(
            facebook_id=facebook_id,
            volunteer_pubkey=volunteer_pubkey,
            nostr_id=nostr_id,
        )
        db.add(event)

    db.commit()


def is_event_published(db: Session, facebook_id: str) -> bool:
    return (
        db.query(PublishedEventORM)
        .filter(PublishedEventORM.facebook_id == facebook_id)
        .first()
        is not None
    )


def queue_event(
    db: Session,
    facebook_id: str,
    volunteer_pubkey: str,
    event_data: str,
    is_trusted: bool,
) -> None:
    existing = (
        db.query(QueuedEventORM)
        .filter(QueuedEventORM.facebook_id == facebook_id)
        .first()
    )

    if existing:
        contributors: list[str] = json.loads(existing.contributors or "[]")
        if volunteer_pubkey not in contributors:
            contributors.append(volunteer_pubkey)
            existing.contributors = json.dumps(contributors)
            if is_trusted:
                existing.consensus_count += 1
    else:
        event = QueuedEventORM(
            facebook_id=facebook_id,
            volunteer_pubkey=volunteer_pubkey,
            event_data=event_data,
            contributors=json.dumps([volunteer_pubkey]),
            consensus_count=1 if is_trusted else 0,
        )
        db.add(event)

    db.commit()


def get_queued_events(db: Session) -> list[QueuedEventORM]:
    return db.query(QueuedEventORM).order_by(QueuedEventORM.created_at).all()


def approve_queued_event(db: Session, facebook_id: str) -> dict | None:
    """Approve a queued event and promote volunteer if needed."""
    event = (
        db.query(QueuedEventORM)
        .filter(QueuedEventORM.facebook_id == facebook_id)
        .first()
    )

    if not event:
        return None

    event_data = event.event_data
    volunteer_pubkey = event.volunteer_pubkey

    volunteer = get_volunteer(db, volunteer_pubkey)
    if volunteer is None:
        return None

    volunteer.approval_count += 1

    if volunteer.approval_count >= 3:
        volunteer.status = VolunteerStatus.TRUSTED

    db.delete(event)
    db.commit()

    return {
        "facebook_id": facebook_id,
        "event_data": event_data,
        "volunteer_pubkey": volunteer_pubkey,
    }


def reject_queued_event(db: Session, facebook_id: str) -> bool:
    event = (
        db.query(QueuedEventORM)
        .filter(QueuedEventORM.facebook_id == facebook_id)
        .first()
    )

    if not event:
        return False

    db.delete(event)
    db.commit()
    return True


def get_all_volunteers(db: Session) -> list[dict]:
    volunteers = db.query(VolunteerORM).order_by(VolunteerORM.created_at).all()

    # Build a map from used_by_pubkey → (issuer_pubkey, issuer_nickname) for used tokens
    used_tokens = (
        db.query(InviteTokenORM, VolunteerORM)
        .join(VolunteerORM, VolunteerORM.pubkey == InviteTokenORM.issuer_pubkey)
        .filter(InviteTokenORM.used == True)  # noqa: E712
        .all()
    )
    invited_by: dict[str, tuple[str, str]] = {
        token.used_by_pubkey: (issuer.pubkey, issuer.nickname)
        for token, issuer in used_tokens
        if token.used_by_pubkey
    }

    # Count how many volunteers each person has directly invited
    invite_counts: dict[str, int] = {}
    for token, _ in used_tokens:
        invite_counts[token.issuer_pubkey] = (
            invite_counts.get(token.issuer_pubkey, 0) + 1
        )

    return [
        {
            "pubkey": v.pubkey,
            "nickname": v.nickname,
            "status": v.status,
            "approval_count": v.approval_count,
            "created_at": v.created_at.isoformat(),
            "invited_by_pubkey": invited_by[v.pubkey][0] if v.pubkey in invited_by else None,
            "invited_by_nickname": invited_by[v.pubkey][1] if v.pubkey in invited_by else None,
            "invite_count": invite_counts.get(v.pubkey) or 0,
        }
        for v in volunteers
    ]


def set_volunteer_status(db: Session, pubkey: str, status: VolunteerStatus) -> bool:
    volunteer = db.query(VolunteerORM).filter(VolunteerORM.pubkey == pubkey).first()
    if not volunteer:
        return False
    volunteer.status = status
    db.commit()
    return True
