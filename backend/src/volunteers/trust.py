"""
Volunteer trust registry: SQLAlchemy ORM storage, invite chain, ban logic.

Seed CLI (run from backend/ dir):
    uv run python -m src.volunteers.trust admin --pubkey <hex-or-npub>
"""
from __future__ import annotations

import argparse
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy.orm import Session

from config import settings
from volunteers.models import Admin, Base, InviteToken, Volunteer

# ---------------------------------------------------------------------------
# Bech32 helpers (NIP-19 npub decoding — no external dependency needed)
# ---------------------------------------------------------------------------

_BECH32_CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l"


def _bech32_polymod(values: list[int]) -> int:
    gen = [0x3B6A57B2, 0x26508E6D, 0x1EA119FA, 0x3D4233DD, 0x2A1462B3]
    chk = 1
    for v in values:
        b = chk >> 25
        chk = (chk & 0x1FFFFFF) << 5 ^ v
        for i in range(5):
            chk ^= gen[i] if (b >> i) & 1 else 0
    return chk


def _bech32_hrp_expand(hrp: str) -> list[int]:
    return [ord(c) >> 5 for c in hrp] + [0] + [ord(c) & 31 for c in hrp]


def _convert_bits(
    data: list[int], frombits: int, tobits: int, pad: bool
) -> bytes | None:
    acc, bits, result = 0, 0, []
    maxv = (1 << tobits) - 1
    for value in data:
        if value < 0 or (value >> frombits):
            return None
        acc = (acc << frombits) | value
        bits += frombits
        while bits >= tobits:
            bits -= tobits
            result.append((acc >> bits) & maxv)
    if pad:
        if bits:
            result.append((acc << (tobits - bits)) & maxv)
    elif bits >= frombits or ((acc << (tobits - bits)) & maxv):
        return None
    return bytes(result)


def _npub_to_hex(npub: str) -> str | None:
    """Decode an npub bech32 string to a 64-char hex pubkey, or None on failure."""
    bech = npub.lower()
    sep = bech.rfind("1")
    if sep < 1 or sep + 7 > len(bech):
        return None
    hrp = bech[:sep]
    if hrp != "npub":
        return None
    data = [_BECH32_CHARSET.find(c) for c in bech[sep + 1:]]
    if any(d == -1 for d in data):
        return None
    if _bech32_polymod(_bech32_hrp_expand(hrp) + data) != 1:
        return None
    raw = _convert_bits(data[:-6], 5, 8, False)
    if raw is None or len(raw) != 32:
        return None
    return raw.hex()


def normalize_pubkey(value: str) -> str | None:
    """Accept a hex pubkey or npub and return lowercase hex, or None on failure."""
    if value.startswith("npub"):
        return _npub_to_hex(value)
    if len(value) == 64 and all(c in "0123456789abcdefABCDEF" for c in value):
        return value.lower()
    return None


def get_whitelist(db: Session) -> list[str]:
    """Return pubkeys of all active (non-banned) volunteers."""
    rows = db.query(Volunteer).filter(Volunteer.status == "active").all()
    return [v.pubkey for v in rows]


def get_all_volunteers(db: Session) -> list[dict[str, object]]:
    """Return all volunteers for admin listing, with display_name and is_admin flag."""
    admin_keys = {a.pubkey for a in db.query(Admin).all()}
    rows = db.query(Volunteer).all()
    return [
        {
            "pubkey": v.pubkey,
            "status": v.status,
            "display_name": v.display_name,
            "invited_by": v.invited_by,
            "registered_at": v.registered_at,
            "is_admin": v.pubkey in admin_keys,
        }
        for v in rows
    ]


def get_volunteer_status(
    db: Session, pubkey: str
) -> dict[str, object]:
    """Return volunteer registration and admin status for a given pubkey."""
    volunteer = db.query(Volunteer).filter(Volunteer.pubkey == pubkey).first()
    is_admin = db.query(Admin).filter(Admin.pubkey == pubkey).first() is not None
    return {
        "is_volunteer": volunteer is not None and volunteer.status == "active",
        "is_admin": is_admin,
        "display_name": volunteer.display_name if volunteer else None,
    }


def get_my_profile(db: Session, pubkey: str) -> dict[str, object] | None:
    """Return a volunteer's own profile with pending invite tokens."""
    volunteer = db.query(Volunteer).filter(Volunteer.pubkey == pubkey).first()
    if volunteer is None:
        return None
    now_iso = datetime.now(UTC).isoformat()
    pending = [
        {
            "token": t.token,
            "created_at": t.created_at,
            "expires_at": t.expires_at,
        }
        for t in volunteer.tokens
        if t.used == 0 and t.expires_at > now_iso
    ]
    return {
        "pubkey": pubkey,
        "display_name": volunteer.display_name,
        "status": volunteer.status,
        "registered_at": volunteer.registered_at,
        "pending_invites": pending,
    }


def get_my_invitees(db: Session, pubkey: str) -> list[dict[str, object]]:
    """Return volunteers who registered using invite tokens issued by pubkey."""
    rows = db.query(Volunteer).filter(Volunteer.invited_by == pubkey).all()
    return [
        {
            "pubkey": v.pubkey,
            "display_name": v.display_name,
            "status": v.status,
            "registered_at": v.registered_at,
        }
        for v in rows
    ]


def update_display_name(db: Session, pubkey: str, name: str) -> bool:
    """Update a volunteer's display name. Returns False if volunteer not found."""
    volunteer = db.query(Volunteer).filter(Volunteer.pubkey == pubkey).first()
    if volunteer is None:
        return False
    volunteer.display_name = name.strip() or None
    db.commit()
    return True


def register_volunteer(
    db: Session,
    pubkey: str,
    invite_token: str,
    display_name: str | None = None,
) -> bool:
    """Validate invite token and register a new volunteer. Returns False on failure."""
    token = db.query(InviteToken).filter(InviteToken.token == invite_token).first()
    if token is None or token.used != 0:
        return False
    if datetime.now(UTC).isoformat() > token.expires_at:
        return False

    issuer = db.query(Volunteer).filter(Volunteer.pubkey == token.issued_by).first()
    if issuer and issuer.status == "banned":
        return False

    existing = db.query(Volunteer).filter(Volunteer.pubkey == pubkey).first()
    if existing is not None:
        return False

    token.used = 1
    volunteer = Volunteer(
        pubkey=pubkey,
        status="active",
        display_name=display_name.strip() if display_name else None,
        invited_by=token.issued_by,
        secret=str(uuid.uuid4()),
        registered_at=datetime.now(UTC).isoformat(),
    )
    db.add(volunteer)
    db.commit()
    return True


def create_invite(db: Session, pubkey: str) -> dict[str, str] | None:
    """Generate a single-use invite token for a volunteer identified by pubkey.

    Returns {"invite_token": uuid, "expires_at": iso} or None on failure.
    """
    issuer = db.query(Volunteer).filter(Volunteer.pubkey == pubkey).first()
    if issuer is None or issuer.status == "banned":
        return None

    now = datetime.now(UTC)
    now_iso = now.isoformat()
    outstanding = (
        db.query(InviteToken)
        .filter(
            InviteToken.issued_by == issuer.pubkey,
            InviteToken.used == 0,
            InviteToken.expires_at > now_iso,
        )
        .count()
    )
    if outstanding >= settings.MAX_OUTSTANDING_INVITES:
        return None

    token_id = str(uuid.uuid4())
    expires_at = now + timedelta(days=settings.INVITE_EXPIRY_DAYS)
    expires_iso = expires_at.isoformat()
    invite = InviteToken(
        token=token_id,
        issued_by=issuer.pubkey,
        used=0,
        created_at=now_iso,
        expires_at=expires_iso,
    )
    db.add(invite)
    db.commit()
    return {"invite_token": token_id, "expires_at": expires_iso}


def ban_volunteer(db: Session, pubkey: str, cascade: bool) -> list[str]:
    """Ban a volunteer and optionally their inviter. Returns list of banned pubkeys."""
    volunteer = db.query(Volunteer).filter(Volunteer.pubkey == pubkey).first()
    if volunteer is None:
        return []

    banned: list[str] = []
    volunteer.status = "banned"
    banned.append(pubkey)

    if cascade and volunteer.invited_by:
        inviter = (
            db.query(Volunteer)
            .filter(Volunteer.pubkey == volunteer.invited_by)
            .first()
        )
        if inviter and inviter.status == "active":
            inviter.status = "banned"
            banned.append(inviter.pubkey)

    db.commit()
    return banned


def unban_volunteer(db: Session, pubkey: str) -> bool:
    """Restore a banned volunteer to active. Returns False if not found."""
    volunteer = db.query(Volunteer).filter(Volunteer.pubkey == pubkey).first()
    if volunteer is None:
        return False
    volunteer.status = "active"
    db.commit()
    return True


def add_volunteer(
    db: Session, pubkey: str, display_name: str | None = None
) -> bool:
    """Directly add a volunteer (admin use). Returns False if already registered."""
    existing = db.query(Volunteer).filter(Volunteer.pubkey == pubkey).first()
    if existing is not None:
        return False
    volunteer = Volunteer(
        pubkey=pubkey,
        status="active",
        display_name=display_name,
        invited_by=None,
        secret=str(uuid.uuid4()),
        registered_at=datetime.now(UTC).isoformat(),
    )
    db.add(volunteer)
    db.commit()
    return True


if __name__ == "__main__":
    import sys
    from pathlib import Path

    _src = str(Path(__file__).parent.parent)
    if _src not in sys.path:
        sys.path.insert(0, _src)

    from volunteers.database import SessionLocal, engine

    Base.metadata.create_all(engine)

    parser = argparse.ArgumentParser(description="Volunteer trust registry CLI")
    sub = parser.add_subparsers(dest="command")

    admin_cmd = sub.add_parser("admin", help="Seed an admin (also adds as volunteer)")
    admin_cmd.add_argument(
        "--pubkey", required=True, help="Admin pubkey (hex or npub)"
    )

    args = parser.parse_args()
    if args.command == "admin":
        pubkey = normalize_pubkey(args.pubkey)
        if pubkey is None:
            print(f"Error: invalid pubkey {args.pubkey!r}", file=sys.stderr)
            sys.exit(1)
        with SessionLocal() as session:
            # Ensure the admin is also a volunteer.
            existing_vol = (
                session.query(Volunteer).filter(Volunteer.pubkey == pubkey).first()
            )
            if existing_vol is None:
                session.add(
                    Volunteer(
                        pubkey=pubkey,
                        status="active",
                        display_name=None,
                        invited_by=None,
                        secret=str(uuid.uuid4()),
                        registered_at=datetime.now(UTC).isoformat(),
                    )
                )
                session.flush()
                print(f"Added volunteer record for admin: {pubkey}")

            existing_admin = (
                session.query(Admin).filter(Admin.pubkey == pubkey).first()
            )
            if existing_admin is not None:
                print(f"Admin {pubkey} already exists")
            else:
                session.add(
                    Admin(pubkey=pubkey, added_at=datetime.now(UTC).isoformat())
                )
                session.commit()
                print(f"Seeded admin: {pubkey}")
    else:
        parser.print_help()
