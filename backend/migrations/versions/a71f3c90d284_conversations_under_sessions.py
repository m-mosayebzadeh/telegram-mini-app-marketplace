"""A conversation between people, with the paid session inside it.

Revision ID: a71f3c90d284
Revises: f27a1b8e4d63

Messaging becomes free (TECHNICAL_REQUIREMENTS.md section 24), so a thread can
no longer be something a paid request owns. The ownership is inverted: a
Conversation holds the people and every message, and a ChatSession is a paid
stretch that runs inside one.

Participants live in their own table rather than as two columns, so that a
three-person event chat and a twenty-person group need no new kind of thread —
only more rows. Capabilities (text, sticker, voice, photo, and the calls that
come later) are a list on the conversation for the same reason: adding one is
a value, not a migration.

Existing sessions each get a conversation built from their own two people, and
their messages move across. Two sessions between the same pair — a repeat
customer — collapse into the single conversation those two people have, which
is the point.

chat_messages.chat_session_id is KEPT, only made optional: a free message
belongs to no session, while a message written during one still has to say so,
both to let a single past session be removed from one side without clearing
the whole thread, and because a complaint has to point at the messages that
belong to the session it is about.
"""
from alembic import op
import sqlalchemy as sa

from app.core.time import UTCDateTime

revision = 'a71f3c90d284'
down_revision = 'f27a1b8e4d63'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'conversations',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('kind', sa.String(length=16), nullable=False, server_default='direct'),
        sa.Column('direct_key', sa.String(length=64), nullable=True),
        sa.Column('base_capabilities', sa.JSON(), nullable=False),
        sa.Column('created_at', UTCDateTime(), nullable=False),
        sa.Column('last_message_at', UTCDateTime(), nullable=True),
        sa.CheckConstraint("kind IN ('direct', 'group', 'event')", name='ck_conversation_kind'),
        # A direct thread must carry its key and the others must not, so the
        # uniqueness below can never be sidestepped by leaving it empty.
        sa.CheckConstraint(
            "(kind = 'direct' AND direct_key IS NOT NULL) OR "
            "(kind <> 'direct' AND direct_key IS NULL)",
            name='ck_conversation_direct_key',
        ),
        sa.UniqueConstraint('direct_key', name='uq_conversation_direct_key'),
    )
    op.create_index('ix_conversations_last_message_at', 'conversations', ['last_message_at'])

    op.create_table(
        'conversation_participants',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('conversation_id', sa.Integer(), sa.ForeignKey('conversations.id'), nullable=False),
        sa.Column('user_id', sa.Integer(), sa.ForeignKey('users.id'), nullable=False),
        sa.Column('joined_at', UTCDateTime(), nullable=False),
        sa.Column('left_at', UTCDateTime(), nullable=True),
        sa.Column('cleared_at', UTCDateTime(), nullable=True),
        sa.Column('archived', sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column('last_read_at', UTCDateTime(), nullable=True),
        sa.UniqueConstraint('conversation_id', 'user_id', name='uq_conversation_participant'),
    )
    op.create_index(
        'ix_conversation_participants_conversation_id', 'conversation_participants', ['conversation_id']
    )
    op.create_index('ix_conversation_participants_user_id', 'conversation_participants', ['user_id'])

    op.add_column('chat_sessions', sa.Column('conversation_id', sa.Integer(), nullable=True))
    op.add_column('chat_messages', sa.Column('conversation_id', sa.Integer(), nullable=True))

    # --- carry the existing threads across ------------------------------
    #
    # One conversation per distinct pair already talking. LEAST/GREATEST put
    # the pair in the stored order; the GROUP BY then folds a repeat
    # customer's several sessions into the one thread those two people have.
    op.execute("""
        INSERT INTO conversations (kind, direct_key, base_capabilities, created_at, last_message_at)
        SELECT 'direct',
               LEAST(r.buyer_id, o.provider_id) || ':' || GREATEST(r.buyer_id, o.provider_id),
               '["text", "sticker"]',
               MIN(cs.opened_at),
               MAX((SELECT MAX(m.created_at) FROM chat_messages m WHERE m.chat_session_id = cs.id))
        FROM chat_sessions cs
        JOIN requests r ON r.id = cs.request_id
        JOIN offers   o ON o.id = r.offer_id
        GROUP BY LEAST(r.buyer_id, o.provider_id), GREATEST(r.buyer_id, o.provider_id)
    """)

    op.execute("""
        UPDATE chat_sessions cs
        SET conversation_id = c.id
        FROM requests r, offers o, conversations c
        WHERE r.id = cs.request_id
          AND o.id = r.offer_id
          AND c.direct_key = LEAST(r.buyer_id, o.provider_id) || ':' || GREATEST(r.buyer_id, o.provider_id)
    """)

    op.execute("""
        UPDATE chat_messages m
        SET conversation_id = cs.conversation_id
        FROM chat_sessions cs
        WHERE cs.id = m.chat_session_id
    """)

    # Both people of every carried-over thread become participants. The
    # per-side state stays on the session it was made on: clearing a whole
    # thread is a new act that nobody has performed yet.
    op.execute("""
        INSERT INTO conversation_participants (conversation_id, user_id, joined_at, archived)
        SELECT DISTINCT c.id, u.user_id, c.created_at, false
        FROM conversations c
        CROSS JOIN LATERAL (
            VALUES (split_part(c.direct_key, ':', 1)::int),
                   (split_part(c.direct_key, ':', 2)::int)
        ) AS u(user_id)
        WHERE c.direct_key IS NOT NULL
    """)

    op.alter_column('chat_sessions', 'conversation_id', nullable=False)
    op.alter_column('chat_messages', 'conversation_id', nullable=False)
    # Free messages have no session, so the old link becomes optional.
    op.alter_column('chat_messages', 'chat_session_id', nullable=True)

    op.create_foreign_key(
        'fk_chat_sessions_conversation_id', 'chat_sessions', 'conversations',
        ['conversation_id'], ['id'],
    )
    op.create_foreign_key(
        'fk_chat_messages_conversation_id', 'chat_messages', 'conversations',
        ['conversation_id'], ['id'],
    )
    op.create_index('ix_chat_sessions_conversation_id', 'chat_sessions', ['conversation_id'])
    op.create_index('ix_chat_messages_conversation_id', 'chat_messages', ['conversation_id'])

    # How someone can be reached. Not used by anything yet — recorded now
    # because the column is cheap and the migration is here.
    op.add_column(
        'profiles',
        sa.Column('chat_door', sa.String(length=16), nullable=False, server_default='open'),
    )
    op.create_check_constraint(
        'ck_profile_chat_door', 'profiles', "chat_door IN ('open', 'paid')"
    )


def downgrade():
    op.drop_constraint('ck_profile_chat_door', 'profiles', type_='check')
    op.drop_column('profiles', 'chat_door')

    # Messages written outside a paid session only exist because messaging
    # became free; the old shape has nowhere to put them.
    op.execute("DELETE FROM chat_messages WHERE chat_session_id IS NULL")
    op.alter_column('chat_messages', 'chat_session_id', nullable=False)

    op.drop_index('ix_chat_messages_conversation_id', table_name='chat_messages')
    op.drop_index('ix_chat_sessions_conversation_id', table_name='chat_sessions')
    op.drop_constraint('fk_chat_messages_conversation_id', 'chat_messages', type_='foreignkey')
    op.drop_constraint('fk_chat_sessions_conversation_id', 'chat_sessions', type_='foreignkey')
    op.drop_column('chat_messages', 'conversation_id')
    op.drop_column('chat_sessions', 'conversation_id')

    op.drop_table('conversation_participants')
    op.drop_index('ix_conversations_last_message_at', table_name='conversations')
    op.drop_table('conversations')
