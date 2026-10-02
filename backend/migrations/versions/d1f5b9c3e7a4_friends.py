"""Friends, two-way, in place of following (section 32, step 4).

Existing follows become friendships: an accepted follow either way makes
the two friends, and a pending one becomes a request from the follower.

Revision ID: d1f5b9c3e7a4
Revises: c9e3a5b7d1f2
"""

import sqlalchemy as sa
from alembic import op

revision = 'd1f5b9c3e7a4'
down_revision = 'c9e3a5b7d1f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        'friendships',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_low_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('user_high_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('requested_by_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('status', sa.String(16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('accepted_at', sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint('user_low_id', 'user_high_id', name='uq_friendship_pair'),
        sa.CheckConstraint('user_low_id < user_high_id', name='ck_friendship_order'),
        sa.CheckConstraint("status IN ('pending', 'accepted')", name='ck_friendship_status'),
    )
    op.create_index('ix_friendships_user_low_id', 'friendships', ['user_low_id'])
    op.create_index('ix_friendships_user_high_id', 'friendships', ['user_high_id'])
    op.create_table(
        'friends_list_viewers',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('owner_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('viewer_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.UniqueConstraint('owner_id', 'viewer_id', name='uq_friends_viewer'),
    )
    op.create_index('ix_friends_list_viewers_owner_id', 'friends_list_viewers', ['owner_id'])
    op.add_column(
        'profiles',
        sa.Column('friends_seen_by', sa.String(16), nullable=False, server_default='everyone'),
    )

    # "Only people I follow" becomes "only my friends".
    op.drop_constraint('ck_profile_chat_door', 'profiles', type_='check')
    op.execute("UPDATE profiles SET chat_door = 'friends' WHERE chat_door = 'following'")
    op.create_check_constraint('ck_profile_chat_door', 'profiles', "chat_door IN ('open', 'friends')")

    # Accepted follows, either way, make friends; one row per pair.
    op.execute("""
        INSERT INTO friendships (user_low_id, user_high_id, requested_by_id, status, created_at, accepted_at)
        SELECT LEAST(follower_id, followee_id), GREATEST(follower_id, followee_id),
               MIN(follower_id), 'accepted', MIN(requested_at), MIN(COALESCE(responded_at, requested_at))
        FROM follows WHERE status = 'accepted' AND follower_id <> followee_id
        GROUP BY LEAST(follower_id, followee_id), GREATEST(follower_id, followee_id)
    """)
    # Pending follows become requests, where the pair is not friends yet.
    op.execute("""
        INSERT INTO friendships (user_low_id, user_high_id, requested_by_id, status, created_at)
        SELECT LEAST(f.follower_id, f.followee_id), GREATEST(f.follower_id, f.followee_id),
               MIN(f.follower_id), 'pending', MIN(f.requested_at)
        FROM follows f WHERE f.status = 'pending' AND f.follower_id <> f.followee_id
          AND NOT EXISTS (SELECT 1 FROM friendships x
                          WHERE x.user_low_id = LEAST(f.follower_id, f.followee_id)
                            AND x.user_high_id = GREATEST(f.follower_id, f.followee_id))
        GROUP BY LEAST(f.follower_id, f.followee_id), GREATEST(f.follower_id, f.followee_id)
    """)


def downgrade() -> None:
    op.drop_constraint('ck_profile_chat_door', 'profiles', type_='check')
    op.execute("UPDATE profiles SET chat_door = 'following' WHERE chat_door = 'friends'")
    op.create_check_constraint('ck_profile_chat_door', 'profiles', "chat_door IN ('open', 'following')")
    op.drop_column('profiles', 'friends_seen_by')
    op.drop_index('ix_friends_list_viewers_owner_id', 'friends_list_viewers')
    op.drop_table('friends_list_viewers')
    op.drop_index('ix_friendships_user_high_id', 'friendships')
    op.drop_index('ix_friendships_user_low_id', 'friendships')
    op.drop_table('friendships')
