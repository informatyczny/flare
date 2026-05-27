"""CLI: seed the first trusted volunteer.

Usage (run from the backend/ directory):
  uv run python src/volunteers/seed.py add --pubkey <hex|npub> --nickname <name>
  uv run python src/volunteers/seed.py list
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))  # src/
sys.path.insert(0, str(Path(__file__).parent.parent.parent))  # backend/

from nostr_sdk import PublicKey  # noqa: E402

from database import SessionLocal, init_db  # noqa: E402
from volunteers.models import VolunteerStatus  # noqa: E402
from volunteers.repository import (
    get_volunteer,
    register_volunteer,
    set_volunteer_status,
)  # noqa: E402


def to_hex(pubkey: str) -> str:
    try:
        return PublicKey.parse(pubkey).to_hex()
    except Exception:
        raise SystemExit(f"Invalid pubkey: {pubkey!r}")


def cmd_add(pubkey: str, nickname: str) -> None:
    pubkey = to_hex(pubkey)
    init_db()
    with SessionLocal() as db:
        existing = get_volunteer(db, pubkey)
        if existing:
            if existing.status != VolunteerStatus.TRUSTED:
                set_volunteer_status(db, pubkey, VolunteerStatus.TRUSTED)
                print(f"Promoted existing volunteer to trusted: {pubkey}")
            else:
                print(f"Already a trusted volunteer: {pubkey}")
            return
        register_volunteer(db, pubkey, nickname)
        set_volunteer_status(db, pubkey, VolunteerStatus.TRUSTED)
    print(f"Added trusted volunteer: {pubkey} ({nickname})")


def cmd_list() -> None:
    init_db()
    with SessionLocal() as db:
        from volunteers.models import VolunteerORM

        volunteers = db.query(VolunteerORM).order_by(VolunteerORM.created_at).all()
    if not volunteers:
        print("No volunteers registered.")
        return
    for v in volunteers:
        print(
            f"{v.status.value:<10} {v.nickname:<20} {v.pubkey}  (approvals: {v.approval_count})"
        )


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage FLARE volunteers")
    sub = parser.add_subparsers(dest="command", required=True)

    add_p = sub.add_parser(
        "add", help="Register a trusted volunteer (bypasses invite flow)"
    )
    add_p.add_argument("--pubkey", required=True)
    add_p.add_argument("--nickname", required=True)

    sub.add_parser("list", help="List all volunteers")

    args = parser.parse_args()
    if args.command == "add":
        cmd_add(args.pubkey, args.nickname)
    elif args.command == "list":
        cmd_list()


if __name__ == "__main__":
    main()
