"""Following removed; friendship replaced it (section 42).

Follows were turned into friendships when friends arrived
(d1f5b9c3e7a4_friends), and nothing has written one since, so the table
goes. The one place that still meant "followers" — who may see a piece of
content — now means friends, the same people under the relationship the
app actually has.

Revision ID: e7b1d5f9c3a6
Revises: d5f9b3e7a1c4
"""

import sqlalchemy as sa
from alembic import op

revision = 'e7b1d5f9c3a6'
down_revision = 'd5f9b3e7a1c4'
branch_labels = None
depends_on = None

AUDIENCE_CHECK = (
    "(audience_type IN ('public', '{shared}')  AND audience_user_id IS NULL AND audience_group_id IS NULL)"
    "OR (audience_type = 'user'  AND audience_user_id IS NOT NULL AND audience_group_id IS NULL)"
    "OR (audience_type = 'group'  AND audience_group_id IS NOT NULL AND audience_user_id IS NULL)"
)


def _audience(old: str, new: str) -> None:
    op.drop_constraint('ck_audience_target_matches_type', 'contents', type_='check')
    op.execute(f"UPDATE contents SET audience_type = '{new}' WHERE audience_type = '{old}'")
    op.create_check_constraint('ck_audience_target_matches_type', 'contents', AUDIENCE_CHECK.format(shared=new))


def upgrade() -> None:
    _audience('followers', 'friends')
    op.drop_table('follows')


def downgrade() -> None:
    # The table comes back empty: the follows themselves live on as
    # friendships and are not split back out.
    op.create_table(
        'follows',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('follower_id', sa.BigInteger(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('followee_id', sa.BigInteger(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.Enum('pending', 'accepted', 'rejected', name='followstatus', native_enum=False), nullable=False),
        sa.Column('requested_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('responded_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('follower_id', 'followee_id', name='uq_follow_pair'),
        sa.CheckConstraint('follower_id != followee_id', name='ck_no_self_follow'),
    )
    _audience('friends', 'followers')
