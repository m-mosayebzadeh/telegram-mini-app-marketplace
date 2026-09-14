"""Deleting an offer or a piece of content marks it, rather than removing it.

Revision ID: d4e8a1f76b52
Revises: 46cd027001d7

Removing the row was quietly corrupting data, and only Postgres said so.
SQLite does not enforce foreign keys unless asked to, so a deleted offer left
its cancelled requests pointing at nothing, and deleted content left real
purchases pointing at nothing — a receipt for an unnamed thing.

Both are cases where the history has to outlive the thing itself. A request
cancelled because its offer went away is counted differently from one the buyer
cancelled, and that distinction only means something while the offer is still
there to look at.

Users never see either once deleted. Staff see everything, which is the point
of keeping it.
"""
from alembic import op
import sqlalchemy as sa
from app.core.time import UTCDateTime

revision = 'd4e8a1f76b52'
down_revision = '46cd027001d7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('offers', sa.Column('deleted_at', UTCDateTime(), nullable=True))
    op.add_column('contents', sa.Column('deleted_at', UTCDateTime(), nullable=True))


def downgrade():
    op.drop_column('contents', 'deleted_at')
    op.drop_column('offers', 'deleted_at')
