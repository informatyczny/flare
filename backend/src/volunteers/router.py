from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from admin.auth import require_volunteer
from lib.loggers import api_logger
from volunteers.database import get_db
from volunteers.trust import (
    create_invite,
    get_my_invitees,
    get_my_profile,
    get_volunteer_status,
    normalize_pubkey,
    register_volunteer,
    update_display_name,
)

router = APIRouter()


@router.get("/volunteers/status")
def volunteer_status(
    pubkey: str, db: Session = Depends(get_db)
) -> dict[str, object]:
    return get_volunteer_status(db, pubkey)


class RegisterRequest(BaseModel):
    pubkey: str
    invite_token: str
    display_name: str = ""


@router.post("/volunteers/register", status_code=201)
def register(req: RegisterRequest, db: Session = Depends(get_db)) -> dict[str, str]:
    pubkey = normalize_pubkey(req.pubkey)
    if pubkey is None:
        raise HTTPException(status_code=400, detail="Invalid pubkey format")
    ok = register_volunteer(db, pubkey, req.invite_token, req.display_name or None)
    if not ok:
        api_logger.warning(
            "Failed registration: invalid token or already registered pubkey=%s",
            pubkey,
        )
        raise HTTPException(
            status_code=400, detail="Invalid invite token or already registered"
        )
    api_logger.info("Volunteer registered pubkey=%s", pubkey)
    return {"status": "registered"}


@router.get("/volunteers/me")
def get_me(
    pubkey: str = Depends(require_volunteer),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    profile = get_my_profile(db, pubkey)
    if profile is None:
        raise HTTPException(status_code=404, detail="Volunteer not found")
    return profile


class UpdateMeRequest(BaseModel):
    display_name: str


@router.patch("/volunteers/me")
def update_me(
    body: UpdateMeRequest,
    pubkey: str = Depends(require_volunteer),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    update_display_name(db, pubkey, body.display_name)
    api_logger.info("Display name updated pubkey=%s", pubkey)
    return {"status": "ok"}


@router.get("/volunteers/me/invitees")
def get_invitees(
    pubkey: str = Depends(require_volunteer),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    return {"invitees": get_my_invitees(db, pubkey)}


@router.post("/volunteers/invite")
def invite(
    pubkey: str = Depends(require_volunteer),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    result = create_invite(db, pubkey)
    if result is None:
        raise HTTPException(
            status_code=403,
            detail="Too many outstanding tokens",
        )
    api_logger.info("Invite token created pubkey=%s", pubkey)
    return result
