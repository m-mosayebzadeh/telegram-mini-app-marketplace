# Database migrations (Alembic)

This folder is managed by [Alembic](https://alembic.sqlalchemy.org/). It's
what keeps the actual database schema (on any machine, or in production
later) in sync with the SQLAlchemy models in `app/models/`, without ever
wiping existing data.

## Why this exists

Before this, `app/main.py`'s startup only called
`Base.metadata.create_all(bind=engine)`, which creates tables that don't
exist yet — but does **nothing** for a column added to an *existing*
table. That gap caused a real incident: a model change (`Profile.is_trusted`,
`Profile.birthday_month/day`) was pulled onto a machine whose local
`app.db` predated it, and the profile page broke everywhere with
"no such column" errors until the schema was fixed by hand.

Alembic replaces `create_all()` for that job. `app/core/migrate.py`'s
`run_migrations()` runs `alembic upgrade head` automatically on every app
startup (see `app/main.py`'s `lifespan`), so a machine that's behind on
schema changes catches up the moment it's next started — the same way
`git pull` already catches it up on code changes.

## Day-to-day workflow: you changed a model

1. Edit the model (add/remove a column, a table, a constraint...) in
   `app/models/`.
2. Generate a migration for that change:
   ```
   alembic revision --autogenerate -m "short description"
   ```
   This compares your **current local database** against the models and
   writes a migration file under `migrations/versions/`.
3. **Always open and read the generated file.** Autogenerate is a good
   first draft, not a guarantee — it can't detect a column rename (it
   sees that as "drop one column, add another," which loses data) and
   doesn't always get SQLite-specific details right. Fix those by hand
   before moving on.
4. Apply it to your own local database:
   ```
   alembic upgrade head
   ```
   (Or just restart the app — `run_migrations()` does this for you.)
5. Commit the new file in `migrations/versions/` along with your model
   change, in the same commit — a model change without its migration
   breaks every other machine's next startup.

## One-time step for a database that pre-dates Alembic

If you (or anyone else) already has a local `app.db` whose schema already
matches the models — because you were on the last commit before Alembic
was added — running `alembic upgrade head` on it will fail with
"table ... already exists": Alembic doesn't know that database is already
caught up, so it tries to create everything from scratch.

The fix is a **one-time** command, not a migration file:
```
alembic stamp head
```
This marks the database as already being at the latest migration,
without actually running any of its SQL. Only do this if you've verified
the schema truly already matches the models (see the "verify" script
below) — stamping a database that's genuinely missing columns just hides
the problem instead of fixing it.

## Verifying a database's schema matches the models

Useful when you're not sure whether a given `app.db` is actually caught
up:
```python
import sqlite3
from app.core.database import Base
from app import models  # noqa: registers every model

con = sqlite3.connect("app.db")
cur = con.cursor()
for table_name, table in Base.metadata.tables.items():
    cur.execute(f"PRAGMA table_info({table_name})")
    existing_cols = {r[1] for r in cur.fetchall()}
    model_cols = {c.name for c in table.columns}
    missing = model_cols - existing_cols
    extra = existing_cols - model_cols
    if missing or extra:
        print(f"{table_name}: missing_in_db={sorted(missing)} extra_in_db={sorted(extra)}")
```
No output means the schema matches exactly.

## Other useful commands

- `alembic current` — which migration the connected database is at.
- `alembic history` — the full chain of migrations, oldest first.
- `alembic downgrade -1` — undo the most recently applied migration
  (only ever tested for SQLite here; use with real caution on a database
  with data you care about).

## A note on SQLite

Unlike Postgres, SQLite can't `ALTER TABLE` a column's type or drop a
constraint in place. `migrations/env.py` turns on Alembic's
`render_as_batch` mode, which works around this by rebuilding the whole
table (create a new one, copy the rows across, drop the old one, rename)
under the hood whenever a migration needs that kind of change. This is
transparent — you write migrations the normal way — but it does mean a
batch migration briefly needs enough free disk space to hold a second
copy of the table being changed.
