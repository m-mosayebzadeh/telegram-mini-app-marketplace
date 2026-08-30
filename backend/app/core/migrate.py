"""
Runs pending Alembic migrations against whatever database
settings.database_url points at — see backend/migrations/ for the
migration files themselves, and their README for the day-to-day workflow
(generating a new one after changing a model).

Called once, from app/main.py's lifespan, on every app startup. This
replaces the old Base.metadata.create_all(bind=engine) approach, which
only ever created tables that didn't exist yet — it silently did nothing
about a column added to an EXISTING table, which is exactly what caused
a real incident: a teammate's machine had an older copy of app.db, pulled
in model changes that added new columns, and every request touching
those columns started failing with "no such column" until the schema was
fixed by hand. Running migrations automatically on startup means a
machine that's behind on schema changes catches up the moment it's next
started, the same way `git pull` catches it up on code changes — nobody
has to remember a separate manual step.
"""

from alembic import command
from alembic.config import Config

from app.core.config import BACKEND_DIR


def run_migrations() -> None:
    alembic_cfg = Config(str(BACKEND_DIR / "alembic.ini"))
    command.upgrade(alembic_cfg, "head")
