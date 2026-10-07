"""People's ids drawn at random, not counted (section 40).

Counting 1, 2, 3 let anybody walk from one person to the next by adding
one, and tell from the newest id how many people the app has. New ids are
drawn by the app (app/models/user.py, new_user_id) from sixteen digits,
which needs a 64-bit column — for users.id and for every column that
points at it. People who already exist keep their ids.

The columns pointing at users.id are found from the database itself, so
none can be missed.

Revision ID: d5f9b3e7a1c4
Revises: c3e7a1d5f9b2
"""

from alembic import op

revision = 'd5f9b3e7a1c4'
down_revision = 'c3e7a1d5f9b2'
branch_labels = None
depends_on = None

POINTING_AT_USERS = """
    SELECT kcu.table_name, kcu.column_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name AND tc.table_schema = kcu.table_schema
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'users' AND ccu.column_name = 'id'
      AND tc.table_schema = current_schema()
"""


def upgrade() -> None:
    bind = op.get_bind()
    columns = sorted(set(bind.exec_driver_sql(POINTING_AT_USERS).fetchall()))
    # The columns pointing at it first, then the id itself; Postgres keeps
    # the foreign keys as they are.
    for table, column in columns:
        op.execute(f'ALTER TABLE "{table}" ALTER COLUMN "{column}" TYPE BIGINT')
    op.execute('ALTER TABLE users ALTER COLUMN id TYPE BIGINT')
    # The app draws new ids itself from now on.
    op.execute('ALTER TABLE users ALTER COLUMN id DROP DEFAULT')


def downgrade() -> None:
    # Random ids do not fit back into 32 bits; only the counting comes back.
    op.execute('CREATE SEQUENCE IF NOT EXISTS users_id_seq OWNED BY users.id')
    op.execute("SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users WHERE id < 2147483647), 1))")
    op.execute("ALTER TABLE users ALTER COLUMN id SET DEFAULT nextval('users_id_seq')")
