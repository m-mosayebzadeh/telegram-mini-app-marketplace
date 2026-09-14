"""add sent_requests_last_viewed_at to users

Revision ID: d4f1b9a6e2c7
Revises: c1c9c5a2ef31
Create Date: 2026-09-02 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.core.time


# revision identifiers, used by Alembic.
revision: str = 'd4f1b9a6e2c7'
down_revision: Union[str, Sequence[str], None] = 'c1c9c5a2ef31'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('sent_requests_last_viewed_at', app.core.time.UTCDateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('sent_requests_last_viewed_at')
