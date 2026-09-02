"""add requests_last_viewed_at to users

Revision ID: af59cf2819d8
Revises: 9c1f2a7e4b3d
Create Date: 2026-09-01 09:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.core.time


# revision identifiers, used by Alembic.
revision: str = 'af59cf2819d8'
down_revision: Union[str, Sequence[str], None] = '9c1f2a7e4b3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('requests_last_viewed_at', app.core.time.UTCDateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('requests_last_viewed_at')
