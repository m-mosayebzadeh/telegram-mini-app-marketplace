"""move requests_last_viewed_at from user to offer (per-offer, not per-user)

Revision ID: c1c9c5a2ef31
Revises: af59cf2819d8
Create Date: 2026-09-02 06:00:00.000000

The previous migration put this on User, on the assumption that opening
the whole "my offers" list was what should clear the badge. Real product
feedback corrected that: opening ONE specific offer's own incoming-
requests list is what clears THAT offer's badge, leaving every other
offer's badge untouched — so the timestamp has to live per-offer, not
per-user. No data worth preserving here (the User column has been live
for all of one commit), so this is a straight drop-and-add rather than a
data migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.core.time


# revision identifiers, used by Alembic.
revision: str = 'c1c9c5a2ef31'
down_revision: Union[str, Sequence[str], None] = 'af59cf2819d8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_column('requests_last_viewed_at')
    with op.batch_alter_table('offers', schema=None) as batch_op:
        batch_op.add_column(sa.Column('requests_last_viewed_at', app.core.time.UTCDateTime(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('offers', schema=None) as batch_op:
        batch_op.drop_column('requests_last_viewed_at')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('requests_last_viewed_at', app.core.time.UTCDateTime(), nullable=True))
