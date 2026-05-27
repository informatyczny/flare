from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from lib.loggers import api_logger
from volunteers.models import InviteRequest, RegisterRequest, VolunteerStatus
from volunteers.repository import (
    create_invite_token,
    get_volunteer,
    register_volunteer,
    use_invite_token,
)
from volunteers.signatures import verify_signature

router = APIRouter()


@router.get("/status")
def volunteer_status(pubkey: str, db: Session = Depends(get_db)) -> dict:
    volunteer = get_volunteer(db, pubkey)
    if not volunteer:
        raise HTTPException(status_code=404, detail="Volunteer not found")
    return {
        "pubkey": volunteer.pubkey,
        "nickname": volunteer.nickname,
        "status": volunteer.status,
    }


@router.post("/register")
async def register(req: RegisterRequest, db: Session = Depends(get_db)) -> dict:
    if not use_invite_token(db, req.invite_token, req.pubkey):
        api_logger.warning(
            "Failed registration: invalid invite token pubkey=%s", req.pubkey
        )
        raise HTTPException(status_code=400, detail="Invalid invite token")

    if not register_volunteer(db, req.pubkey, req.nickname):
        api_logger.warning(
            "Failed registration: volunteer already exists pubkey=%s", req.pubkey
        )
        raise HTTPException(status_code=400, detail="Volunteer already exists")

    api_logger.info(
        "Volunteer registered pubkey=%s nickname=%s", req.pubkey, req.nickname
    )
    return {"status": "registered", "trust_status": VolunteerStatus.PROBATION}


@router.post("/invite")
async def invite(req: InviteRequest, db: Session = Depends(get_db)) -> dict:
    volunteer = get_volunteer(db, req.pubkey)

    if not volunteer:
        raise HTTPException(status_code=401, detail="Unknown volunteer")

    if volunteer.status != VolunteerStatus.TRUSTED:
        raise HTTPException(
            status_code=403, detail="Only trusted volunteers can invite"
        )

    if not verify_signature({"pubkey": req.pubkey}, req.signature, req.pubkey):
        raise HTTPException(status_code=401, detail="Invalid signature")

    token = create_invite_token(db, req.pubkey)
    if not token:
        raise HTTPException(
            status_code=429, detail="Too many outstanding tokens for this volunteer"
        )

    api_logger.info("Invite token created for volunteer pubkey=%s", req.pubkey)
    return {"invite_token": token}
