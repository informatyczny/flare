from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from admin.auth import require_admin
from lib.loggers import api_logger
from volunteers.database import get_db
from volunteers.models import Admin
from volunteers.trust import (
    add_volunteer,
    ban_volunteer,
    get_all_volunteers,
    get_whitelist,
    normalize_pubkey,
    unban_volunteer,
)

router = APIRouter()


@router.get("/admin/check")
def check_admin(pubkey: str, db: Session = Depends(get_db)) -> dict[str, bool]:
    is_admin = db.query(Admin).filter(Admin.pubkey == pubkey).first() is not None
    return {"is_admin": is_admin}


@router.get("/trust/whitelist")
def whitelist(db: Session = Depends(get_db)) -> dict[str, list[str]]:
    return {"pubkeys": get_whitelist(db)}


class AddVolunteerRequest(BaseModel):
    pubkey: str


@router.post("/admin/volunteers", status_code=201)
def add_volunteer_endpoint(
    body: AddVolunteerRequest,
    _admin: str = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    pubkey = normalize_pubkey(body.pubkey)
    if pubkey is None:
        raise HTTPException(status_code=400, detail="Invalid pubkey format")
    if not add_volunteer(db, pubkey):
        raise HTTPException(status_code=409, detail="Volunteer already registered")
    api_logger.info("Admin added volunteer pubkey=%s", pubkey)
    return {"pubkey": pubkey, "status": "active"}


class BanRequest(BaseModel):
    cascade: bool = False


@router.post("/admin/ban/{pubkey}")
def ban(
    pubkey: str,
    body: BanRequest,
    _admin: str = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, list[str]]:
    if db.query(Admin).filter(Admin.pubkey == pubkey).first():
        raise HTTPException(status_code=403, detail="Cannot ban an admin")
    banned = ban_volunteer(db, pubkey, body.cascade)
    if not banned:
        raise HTTPException(status_code=404, detail="Volunteer not found")
    api_logger.info("Banned pubkeys=%s cascade=%s", banned, body.cascade)
    return {"banned": banned}


@router.post("/admin/unban/{pubkey}")
def unban(
    pubkey: str,
    _admin: str = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, str]:
    if not unban_volunteer(db, pubkey):
        raise HTTPException(status_code=404, detail="Volunteer not found")
    api_logger.info("Unbanned pubkey=%s", pubkey)
    return {"status": "active"}


@router.get("/admin/volunteers")
def list_volunteers(
    _admin: str = Depends(require_admin),
    db: Session = Depends(get_db),
) -> dict[str, Any]:
    return {"volunteers": get_all_volunteers(db)}
