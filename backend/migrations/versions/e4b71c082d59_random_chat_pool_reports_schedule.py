"""The random-chat pool, reports and suspensions, and feature scheduling.

Revision ID: e4b71c082d59
Revises: c5a2f19b3e77

Five tables for the first phase of random chat
(TECHNICAL_REQUIREMENTS.md section 28).

feature_schedules stores a window as two wall-clock minutes and no timezone,
because "ten at night" has to mean ten at night wherever the viewer is; an
absolute instant cannot express that.

random_chat_tickets is a pool rather than a queue — one row per waiting
person, so tapping the button repeatedly costs nothing — and it freezes the
gender and age it was joined with, so the matcher never re-reads a profile
mid-run.

reports and suspensions exist because free messaging opened a channel to
everyone. Nothing about them is automatic: an automatic punishment is never
permanent and a permanent one is never automatic, so a suspension always has
an end and always has a person's name on it.
"""
from alembic import op
import sqlalchemy as sa

from app.core.time import UTCDateTime

revision = 'e4b71c082d59'
down_revision = 'c5a2f19b3e77'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'feature_schedules',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('feature', sa.String(length=32), nullable=False),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('opens_at_minute', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('closes_at_minute', sa.Integer(), nullable=False, server_default='1440'),
        # The number and the switch are separate columns so that ticking
        # "unlimited" in the panel greys the number out without losing it.
        sa.Column('daily_quota', sa.Integer(), nullable=False, server_default='10'),
        sa.Column('daily_quota_unlimited', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('updated_at', UTCDateTime(), nullable=False),
        sa.CheckConstraint(
            'opens_at_minute BETWEEN 0 AND 1440 AND closes_at_minute BETWEEN 0 AND 1440',
            name='ck_feature_schedule_minutes',
        ),
        sa.UniqueConstraint('feature', name='uq_feature_schedule_feature'),
    )

    # Random chat exists but is shut, which is the owner's plan: build it in
    # full, hold it closed until the community is large enough, and test it
    # ourselves in the meantime.
    op.execute("""
        INSERT INTO feature_schedules (feature, enabled, opens_at_minute, closes_at_minute, updated_at)
        VALUES ('random_chat', false, 0, 1440, NOW())
    """)

    op.create_table(
        'random_chat_tickets',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('wants_gender', sa.String(length=16), nullable=False, server_default='anyone'),
        sa.Column('wants_age_min', sa.Integer(), nullable=True),
        sa.Column('wants_age_max', sa.Integer(), nullable=True),
        sa.Column('tags', sa.JSON(), nullable=False),
        sa.Column('gender', sa.String(length=16), nullable=True),
        sa.Column('age', sa.Integer(), nullable=True),
        sa.Column('local_minute', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('joined_at', UTCDateTime(), nullable=False),
        # The row outlives the wait: it is also the record of what this
        # person last searched for, so the next search can open with those
        # choices already filled in.
        sa.Column('active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.CheckConstraint(
            "wants_gender IN ('male', 'female', 'anyone')", name='ck_ticket_wants_gender'
        ),
        sa.CheckConstraint(
            'wants_age_min IS NULL OR wants_age_max IS NULL OR wants_age_min <= wants_age_max',
            name='ck_ticket_age_range',
        ),
        # One entry per person, enforced here rather than by looking first:
        # two taps arriving together must not produce two tickets.
        sa.UniqueConstraint('user_id', name='uq_random_chat_ticket_user'),
    )
    op.create_index('ix_random_chat_tickets_joined_at', 'random_chat_tickets', ['joined_at'])
    op.create_index('ix_random_chat_tickets_active', 'random_chat_tickets', ['active'])

    op.create_table(
        'random_chat_sessions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('conversation_id', sa.Integer(), sa.ForeignKey('conversations.id'), nullable=False),
        sa.Column('user_a_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('user_b_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('created_conversation', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('shared_tags', sa.JSON(), nullable=False),
        sa.Column('started_at', UTCDateTime(), nullable=False),
        sa.Column('ended_at', UTCDateTime(), nullable=True),
        sa.Column('ended_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.Column('kept_by_a', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('kept_by_b', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index('ix_random_chat_sessions_conversation_id', 'random_chat_sessions', ['conversation_id'])
    op.create_index('ix_random_chat_sessions_user_a_id', 'random_chat_sessions', ['user_a_id'])
    op.create_index('ix_random_chat_sessions_user_b_id', 'random_chat_sessions', ['user_b_id'])

    op.create_table(
        'reports',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('reporter_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('reported_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('reason', sa.String(length=16), nullable=False),
        sa.Column('conversation_id', sa.Integer(), sa.ForeignKey('conversations.id'), nullable=True),
        sa.Column('created_at', UTCDateTime(), nullable=False),
        sa.Column('reviewed_at', UTCDateTime(), nullable=True),
        sa.Column('reviewed_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=True),
        sa.CheckConstraint(
            "reason IN ('insult', 'sexual', 'scam', 'spam', 'other')", name='ck_report_reason'
        ),
        sa.CheckConstraint('reporter_id <> reported_user_id', name='ck_report_not_self'),
    )
    op.create_index('ix_reports_reporter_id', 'reports', ['reporter_id'])
    op.create_index('ix_reports_reported_user_id', 'reports', ['reported_user_id'])
    op.create_index('ix_reports_conversation_id', 'reports', ['conversation_id'])
    op.create_index('ix_reports_created_at', 'reports', ['created_at'])

    op.create_table(
        'suspensions',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('scope', sa.String(length=24), nullable=False),
        sa.Column('created_at', UTCDateTime(), nullable=False),
        sa.Column('expires_at', UTCDateTime(), nullable=False),
        sa.Column('created_by_user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('note', sa.String(length=300), nullable=True),
        sa.CheckConstraint(
            "scope IN ('random_chat', 'new_conversations', 'everything')",
            name='ck_suspension_scope',
        ),
    )
    op.create_index('ix_suspensions_user_id', 'suspensions', ['user_id'])
    op.create_index('ix_suspensions_expires_at', 'suspensions', ['expires_at'])


def downgrade():
    op.drop_table('suspensions')
    op.drop_table('reports')
    op.drop_table('random_chat_sessions')
    op.drop_table('random_chat_tickets')
    op.drop_table('feature_schedules')
