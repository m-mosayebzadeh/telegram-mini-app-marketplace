"""
Wipes every row from every table EXCEPT alembic_version (so the schema
itself, and Alembic's record of which migration it's at, are untouched
— only data is cleared). Order matters: children are deleted before the
parents they have a foreign key to, so this doesn't trip over SQLite's
foreign-key checks.

Run from backend/:
    python scripts/truncate_all.py
"""

import sqlite3

from app.core.config import settings

# Children first, parents last.
TABLES_IN_DELETE_ORDER = [
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
    "credit_ledger_entries",
    "transactions",
    "admin_grants",
    "profile_photos",
    "profiles",
    "users",
]


def main() -> None:
    db_path = settings.database_url.removeprefix("sqlite:///")
    con = sqlite3.connect(db_path)
    cur = con.cursor()
    cur.execute("PRAGMA foreign_keys = OFF")  # belt-and-suspenders; delete order already handles it
    for table in TABLES_IN_DELETE_ORDER:
        cur.execute(f"DELETE FROM {table}")
        print(f"{table}: {cur.rowcount} rows deleted")
    # Resets AUTOINCREMENT counters so new rows start back at id 1
    # instead of continuing from wherever they left off.
    cur.execute("DELETE FROM sqlite_sequence")
    con.commit()
    con.close()
    print("Done. alembic_version was left untouched.")


if __name__ == "__main__":
    main()
