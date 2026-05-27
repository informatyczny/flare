from __future__ import annotations

import base64
import sys
import time
from pathlib import Path

from fastapi import Depends, Header, HTTPException, Request
from sqlalchemy.orm import Session

_src = str(Path(__file__).parent.parent)
if _src not in sys.path:
    sys.path.insert(0, _src)

from nostr_sdk import Event, Kind  # type: ignore[import-untyped]

from volunteers.database import get_db
from volunteers.models import Admin, Volunteer

_NIP98_KIND = Kind(27235)
_MAX_AGE_SECS = 60


def _parse_nip98(authorization: str | None, request: Request) -> Event:
    if not authorization or not authorization.startswith("Nostr "):
        raise HTTPException(status_code=401, detail="Missing Nostr authorization")

    try:
        event_json = base64.b64decode(authorization[6:]).decode()
        event = Event.from_json(event_json)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid authorization payload")

    if not event.verify():
        raise HTTPException(status_code=401, detail="Invalid event signature")

    if event.kind().as_u16() != _NIP98_KIND.as_u16():
        raise HTTPException(status_code=401, detail="Wrong event kind for NIP-98")

    age = int(time.time()) - event.created_at().as_secs()
    if not (0 <= age <= _MAX_AGE_SECS):
        raise HTTPException(status_code=401, detail="Authorization event expired")

    tags = {
        tag.as_vec()[0]: tag.as_vec()[1]
        for tag in event.tags().to_vec()
        if len(tag.as_vec()) >= 2
    }

    if tags.get("u") != str(request.url):
        raise HTTPException(status_code=401, detail="URL mismatch in authorization")

    if tags.get("method", "").upper() != request.method.upper():
        raise HTTPException(status_code=401, detail="Method mismatch in authorization")

    return event


def require_admin(
    request: Request,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> str:
    event = _parse_nip98(authorization, request)
    pubkey: str = event.author().to_hex()

    if not db.query(Admin).filter(Admin.pubkey == pubkey).first():
        raise HTTPException(status_code=403, detail="Not an admin")

    return pubkey


def require_volunteer(
    request: Request,
    authorization: str | None = Header(None),
    db: Session = Depends(get_db),
) -> str:
    event = _parse_nip98(authorization, request)
    pubkey: str = event.author().to_hex()

    volunteer = (
        db.query(Volunteer)
        .filter(Volunteer.pubkey == pubkey, Volunteer.status == "active")
        .first()
    )
    if not volunteer:
        raise HTTPException(status_code=403, detail="Not a registered active volunteer")

    return pubkey
