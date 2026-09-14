"""
Wipes every row from every table EXCEPT alembic_version (so the schema
itself, and Alembic's record of which migration it's at, are untouched
— only data is cleared). Order matters: children are deleted before the
parents they have a foreign key to, so this doesn't trip over the
database's foreign-key checks.

Run from backend/:
    python scripts/truncate_all.py
"""

import sys
from pathlib import Path

# Same fix as scripts/seed_demo_profile.py: running this as a plain
# script (not `python -m scripts.truncate_all`) means backend/ itself
# isn't on sys.path yet, so `import app...` fails with ModuleNotFoundError
# unless we add it ourselves first.
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app.core.config import settings  # noqa: E402

# Children first, parents last.
TABLES_IN_DELETE_ORDER = [
    "withdrawal_events",
    "credit_ledger_entries",
    "withdrawals",
    "bank_accounts",
    "chat_messages",
    "chat_sessions",
    "content_open_logs",
    "content_purchases",
    "likes",
    "contents",
    "audience_group_members",
    "audience_groups",
    "follows",
    "requests",
    "offers",
    "topup_requests",
    "star_purchases",
    "transactions",
    "admin_grants",
    "roles",
    "profile_photos",
    "profiles",
    "users",
]


def main() -> None:
    """Deletes through the ORM's engine, so this works on whatever database is
    configured rather than reaching for a file on disk."""
    from sqlalchemy import text

    from app.core.database import engine

    with engine.begin() as connection:
        for table in TABLES_IN_DELETE_ORDER:
            result = connection.execute(text(f"DELETE FROM {table}"))
            print(f"{table}: {result.rowcount} rows deleted")
        # Identity counters go back to 1, so a fresh run starts at id 1 instead
        # of continuing from wherever the last one left off.
        for table in TABLES_IN_DELETE_ORDER:
            connection.execute(
                text(f"ALTER SEQUENCE IF EXISTS {table}_id_seq RESTART WITH 1")
            )
    print("Done. alembic_version was left untouched.")


if __name__ == "__main__":
    main()
