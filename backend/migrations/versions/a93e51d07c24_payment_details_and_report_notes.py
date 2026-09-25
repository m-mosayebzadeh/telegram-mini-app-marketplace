"""Payment details in a chat, and what a reporter can say.

Revision ID: a93e51d07c24
Revises: f60c92a4ed18

A message now remembers whether it carried a card number, Sheba, phone
number or handle. Nothing is refused because of it: the conversation shows
a warning, and staff look for accounts that hand these details to many
different strangers — which is the shape a scam has and a friendship does
not.

Reports gain a reason of their own for being asked to pay outside the app,
the specific move this product exists to protect people from, and a few
optional words in the reporter's own voice.
"""
from alembic import op
import sqlalchemy as sa

revision = 'a93e51d07c24'
down_revision = 'f60c92a4ed18'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'chat_messages',
        sa.Column('flagged_payment', sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.create_index('ix_chat_messages_flagged_payment', 'chat_messages', ['flagged_payment'])

    op.alter_column('reports', 'reason', type_=sa.String(length=24))
    op.add_column('reports', sa.Column('note', sa.String(length=500), nullable=True))
    op.drop_constraint('ck_report_reason', 'reports', type_='check')
    op.create_check_constraint(
        'ck_report_reason',
        'reports',
        "reason IN ('off_app_payment', 'insult', 'sexual', 'scam', 'spam', 'other')",
    )


def downgrade():
    # Reports filed under the new reason have no old home; they become
    # "scam", which is the nearest thing the old list had.
    op.execute("UPDATE reports SET reason = 'scam' WHERE reason = 'off_app_payment'")
    op.drop_constraint('ck_report_reason', 'reports', type_='check')
    op.create_check_constraint(
        'ck_report_reason',
        'reports',
        "reason IN ('insult', 'sexual', 'scam', 'spam', 'other')",
    )
    op.drop_column('reports', 'note')
    op.alter_column('reports', 'reason', type_=sa.String(length=16))

    op.drop_index('ix_chat_messages_flagged_payment', table_name='chat_messages')
    op.drop_column('chat_messages', 'flagged_payment')
