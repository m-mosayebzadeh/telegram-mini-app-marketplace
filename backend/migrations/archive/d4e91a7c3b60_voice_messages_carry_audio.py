"""Voice messages carry real audio.

Recording used to be simulated: the frontend timed a fake recording and
sent only its length, so the CHECK constraint asserted that a voice
message never has a file. It does now.

The file stays OPTIONAL rather than required, because messages recorded
before this have a duration and nothing to play, and they have to keep
rendering — the frontend shows those without a play control instead of
offering one that cannot work.

Revision ID: d4e91a7c3b60
Revises: c82f5b1d4e73
"""

from alembic import op

revision = "d4e91a7c3b60"
down_revision = "c82f5b1d4e73"
branch_labels = None
depends_on = None

# SQLite cannot ALTER a CHECK constraint, so the table is rebuilt with
# batch_alter_table — which is also why the constraint has to be spelled
# out in full on both sides rather than patched.
_OLD = (
    "(type = 'text' AND text IS NOT NULL AND file_path IS NULL AND duration_seconds IS NULL) OR "
    "(type = 'photo' AND file_path IS NOT NULL AND text IS NULL AND duration_seconds IS NULL) OR "
    "(type = 'video' AND file_path IS NOT NULL AND duration_seconds IS NOT NULL AND text IS NULL) OR "
    "(type = 'voice' AND file_path IS NULL AND duration_seconds IS NOT NULL AND text IS NULL)"
)

_NEW = (
    "(type = 'text' AND text IS NOT NULL AND file_path IS NULL AND duration_seconds IS NULL) OR "
    "(type = 'photo' AND file_path IS NOT NULL AND text IS NULL AND duration_seconds IS NULL) OR "
    "(type = 'video' AND file_path IS NOT NULL AND duration_seconds IS NOT NULL AND text IS NULL) OR "
    "(type = 'voice' AND duration_seconds IS NOT NULL AND text IS NULL)"
)

_NAME = "ck_chat_message_fields_match_type"


def upgrade() -> None:
    with op.batch_alter_table("chat_messages") as batch:
        batch.drop_constraint(_NAME, type_="check")
        batch.create_check_constraint(_NAME, _NEW)


def downgrade() -> None:
    # A voice message that now has audio would violate the old rule, so
    # its file is forgotten rather than the downgrade failing.
    op.execute("UPDATE chat_messages SET file_path = NULL WHERE type = 'voice'")
    with op.batch_alter_table("chat_messages") as batch:
        batch.drop_constraint(_NAME, type_="check")
        batch.create_check_constraint(_NAME, _OLD)
