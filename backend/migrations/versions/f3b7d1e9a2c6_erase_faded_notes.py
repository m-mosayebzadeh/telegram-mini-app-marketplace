"""Erase notes a day after they were written, and the index that lets the
hourly sweep find them without reading every profile (section 32, the
owner's decision: a note is erased, not only hidden).

Notes that had already faded are erased here once, so the database does
not keep the old ones until the first sweep.

Revision ID: f3b7d1e9a2c6
Revises: e2a6c0d4f8b5
"""

from alembic import op

revision = 'f3b7d1e9a2c6'
down_revision = 'e2a6c0d4f8b5'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(
        'CREATE INDEX IF NOT EXISTS ix_profiles_note_at ON profiles (note_at) WHERE note_at IS NOT NULL'
    )
    op.execute(
        "UPDATE profiles SET note = NULL, note_at = NULL "
        "WHERE note_at IS NOT NULL AND note_at < now() - interval '1 day'"
    )


def downgrade() -> None:
    # The erased notes cannot come back; only the index goes.
    op.execute('DROP INDEX IF EXISTS ix_profiles_note_at')
