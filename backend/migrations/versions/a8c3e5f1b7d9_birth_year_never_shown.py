"""birth year never shown: the hide switch goes

Nothing shows another person's birth year any more, so the server stops
sending it to anybody but its owner, and the per-person switch to hide it
has nothing left to do (TECHNICAL_REQUIREMENTS.md section 43). The year
itself stays: Echo still works out an age from it.

Revision ID: a8c3e5f1b7d9
Revises: e7b1d5f9c3a6
"""
from alembic import op
import sqlalchemy as sa

revision = 'a8c3e5f1b7d9'
down_revision = 'e7b1d5f9c3a6'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column('profiles', 'hide_birth_year')


def downgrade() -> None:
    op.add_column('profiles', sa.Column('hide_birth_year', sa.Boolean(), server_default='false', nullable=False))
