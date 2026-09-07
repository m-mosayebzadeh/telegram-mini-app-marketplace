"""add roles table, repurpose admin_grants to (user, role) pairs

Revision ID: b7e5c3a8f1d2
Revises: d4f1b9a6e2c7
Create Date: 2026-09-07 09:00:00.000000

admin_grants used to be one row per user, carrying that user's whole
flat scope list directly (unique on user_id). It's now one row per
(user, role) pair instead — a user can hold several roles, each
contributing its own scopes (see app/models/role.py). This is a
straight rebuild, not a data migration: the feature has had minimal
real usage so far (a couple of dev grants), so there's nothing worth
preserving that couldn't just be re-granted by hand through the new
role-based admin UI.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.core.time


# revision identifiers, used by Alembic.
revision: str = 'b7e5c3a8f1d2'
down_revision: Union[str, Sequence[str], None] = 'd4f1b9a6e2c7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'roles',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('name', sa.String(length=64), nullable=False),
        sa.Column('scopes', sa.JSON(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('name'),
    )

    op.drop_table('admin_grants')
    op.create_table(
        'admin_grants',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('role_id', sa.Integer(), nullable=False),
        sa.Column('granted_by_user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(['granted_by_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['role_id'], ['roles.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'role_id', name='uq_admin_grant_user_role'),
    )


def downgrade() -> None:
    op.drop_table('admin_grants')
    op.create_table(
        'admin_grants',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('scopes', sa.JSON(), nullable=False),
        sa.Column('granted_by_user_id', sa.Integer(), nullable=False),
        sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
        sa.ForeignKeyConstraint(['granted_by_user_id'], ['users.id']),
        sa.ForeignKeyConstraint(['user_id'], ['users.id']),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
    )
    op.drop_table('roles')
