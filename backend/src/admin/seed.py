"""CLI: manage admin pubkeys.

Usage (run from the backend/ directory):
  uv run python src/admin/seed.py add --pubkey <hex|npub>
  uv run python src/admin/seed.py list
  uv run python src/admin/seed.py remove --pubkey <hex|npub>
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from nostr_sdk import PublicKey  # noqa: E402

from admin.models import AdminORM  # noqa: E402 — path must be set first
from database import SessionLocal, init_db  # noqa: E402


def to_hex(pubkey: str) -> str:
    try:
        return PublicKey.parse(pubkey).to_hex()
    except Exception:
        raise SystemExit(f"Invalid pubkey: {pubkey!r}")


def cmd_add(pubkey: str) -> None:
    pubkey = to_hex(pubkey)
    init_db()
    with SessionLocal() as db:
        if db.query(AdminORM).filter(AdminORM.pubkey == pubkey).first():
            print(f"Already an admin: {pubkey}")
            return
        db.add(AdminORM(pubkey=pubkey))
        db.commit()
    print(f"Added admin: {pubkey}")


def cmd_list() -> None:
    init_db()
    with SessionLocal() as db:
        admins = db.query(AdminORM).all()
    if not admins:
        print("No admins registered.")
        return
    for a in admins:
        print(f"{a.pubkey}  (added {a.added_at.isoformat()})")


def cmd_remove(pubkey: str) -> None:
    pubkey = to_hex(pubkey)
    init_db()
    with SessionLocal() as db:
        row = db.query(AdminORM).filter(AdminORM.pubkey == pubkey).first()
        if not row:
            print(f"Not found: {pubkey}")
            return
        db.delete(row)
        db.commit()
    print(f"Removed admin: {pubkey}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Manage FLARE admin pubkeys")
    sub = parser.add_subparsers(dest="command", required=True)

    add_p = sub.add_parser("add", help="Register an admin pubkey")
    add_p.add_argument("--pubkey", required=True)

    sub.add_parser("list", help="List registered admins")

    rm_p = sub.add_parser("remove", help="Remove an admin pubkey")
    rm_p.add_argument("--pubkey", required=True)

    args = parser.parse_args()
    if args.command == "add":
        cmd_add(args.pubkey)
    elif args.command == "list":
        cmd_list()
    elif args.command == "remove":
        cmd_remove(args.pubkey)


if __name__ == "__main__":
    main()
