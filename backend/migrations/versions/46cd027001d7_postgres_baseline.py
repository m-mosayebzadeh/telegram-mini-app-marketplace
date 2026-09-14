"""The whole schema, as one migration, portable to Postgres.

Revision ID: 46cd027001d7
Revises:

Twenty-four migrations collapse into this one. They had to: several of them
were hand-written SQLite — create a new table, copy the rows, drop the old one,
rename — because SQLite cannot alter a constraint at all. On an empty Postgres
database those fail outright, so replaying that history was never going to be
the way across.

Since no real data exists yet, a squash is both safe and an improvement: every
workaround those twenty-four had accumulated goes with them, and what is left
describes the schema as it actually is rather than as a sequence of repairs.
The originals are kept under migrations/archive/ for reference.

Enums are stored as text with a CHECK, on every engine (see the models'
native_enum=False). Postgres would otherwise create a type per enum, and adding
a value to one of those later is an ALTER TYPE that cannot run inside a
transaction — a category of future pain bought for nothing, since the values
are already constrained here.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import app.core.time

# revision identifiers, used by Alembic.
revision: str = '46cd027001d7'
down_revision: Union[str, Sequence[str], None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('platform_rates',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('drop_to_toman_rate', sa.Integer(), nullable=False),
    sa.Column('chat_commission_percent', sa.Integer(), nullable=False),
    sa.Column('content_commission_percent', sa.Integer(), nullable=False),
    sa.Column('withdrawal_commission_percent', sa.Integer(), nullable=False),
    sa.Column('complaint_commission_percent', sa.Integer(), nullable=False),
    sa.Column('minimum_withdrawal_toman', sa.Integer(), nullable=False),
    sa.Column('updated_at', app.core.time.UTCDateTime(), nullable=False),
    sa.CheckConstraint('chat_commission_percent BETWEEN 0 AND 100 AND content_commission_percent BETWEEN 0 AND 100', name='ck_purchase_commission_percentages'),
    sa.CheckConstraint('drop_to_toman_rate > 0 AND minimum_withdrawal_toman > 0', name='ck_positive_financial_rates'),
    sa.CheckConstraint('withdrawal_commission_percent BETWEEN 0 AND 100 AND complaint_commission_percent BETWEEN 0 AND 100', name='ck_financial_percentages'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('roles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('scopes', sa.JSON(), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('name')
    )
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('telegram_id', sa.BigInteger(), nullable=False),
    sa.Column('first_name', sa.String(length=128), nullable=False),
    sa.Column('last_name', sa.String(length=128), nullable=True),
    sa.Column('username', sa.String(length=64), nullable=True),
    sa.Column('joined_at', app.core.time.UTCDateTime(), nullable=False),
    sa.Column('status', sa.Enum('active', 'blocked', name='userstatus', native_enum=False), nullable=False),
    sa.Column('sent_requests_last_viewed_at', app.core.time.UTCDateTime(), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('username')
    )
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_users_telegram_id'), ['telegram_id'], unique=True)

    op.create_table('admin_grants',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('role_id', sa.Integer(), nullable=False),
    sa.Column('granted_by_user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['granted_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['role_id'], ['roles.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'role_id', name='uq_admin_grant_user_role')
    )
    op.create_table('audience_groups',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('owner_id', sa.Integer(), nullable=False),
    sa.Column('name', sa.String(length=64), nullable=False),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['owner_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('bank_accounts',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('holder_name', sa.String(length=128), nullable=False),
    sa.Column('card_number', sa.String(length=16), nullable=False),
    sa.Column('iban', sa.String(length=26), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('bank_accounts', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_bank_accounts_user_id'), ['user_id'], unique=False)

    op.create_table('follows',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('follower_id', sa.Integer(), nullable=False),
    sa.Column('followee_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('pending', 'accepted', 'rejected', name='followstatus', native_enum=False), nullable=False),
    sa.Column('requested_at', app.core.time.UTCDateTime(), nullable=False),
    sa.Column('responded_at', app.core.time.UTCDateTime(), nullable=True),
    sa.CheckConstraint('follower_id != followee_id', name='ck_no_self_follow'),
    sa.ForeignKeyConstraint(['followee_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['follower_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('follower_id', 'followee_id', name='uq_follow_pair')
    )
    op.create_table('offers',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('provider_id', sa.Integer(), nullable=False),
    sa.Column('service_type', sa.Enum('chat', name='offerservicetype', native_enum=False), nullable=False),
    sa.Column('price_drops', sa.Integer(), nullable=False),
    sa.Column('session_duration_seconds', sa.Integer(), nullable=False),
    sa.Column('title', sa.String(length=200), nullable=False),
    sa.Column('description', sa.String(length=2000), nullable=False),
    sa.Column('status', sa.Enum('active', 'inactive', name='offerstatus', native_enum=False), nullable=False),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.Column('requests_last_viewed_at', app.core.time.UTCDateTime(), nullable=True),
    sa.CheckConstraint('price_drops > 0 AND price_drops % 4 = 0', name='ck_offer_price_divides_into_blocks'),
    sa.CheckConstraint('session_duration_seconds > 0 AND session_duration_seconds % 4 = 0', name='ck_offer_duration_divides_into_blocks'),
    sa.ForeignKeyConstraint(['provider_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('profile_photos',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('url', sa.String(length=500), nullable=False),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('profiles',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('bio', sa.String(length=100), nullable=True),
    sa.Column('location', sa.String(length=200), nullable=True),
    sa.Column('interests', sa.JSON(), nullable=False),
    sa.Column('is_trusted', sa.Boolean(), nullable=False),
    sa.Column('birthday_month', sa.Integer(), nullable=True),
    sa.Column('birthday_day', sa.Integer(), nullable=True),
    sa.Column('birthday_year', sa.Integer(), nullable=True),
    sa.CheckConstraint('(birthday_month IS NULL AND birthday_day IS NULL AND birthday_year IS NULL) OR (birthday_month BETWEEN 1 AND 12 AND birthday_day BETWEEN 1 AND 31  AND (birthday_year IS NULL OR birthday_year BETWEEN 1900 AND 2100))', name='ck_birthday_both_or_neither'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id')
    )
    op.create_table('topup_requests',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('receipt_file_path', sa.String(length=500), nullable=False),
    sa.Column('requested_drops', sa.Integer(), nullable=False),
    sa.Column('drop_rate_at_request', sa.Integer(), nullable=False),
    sa.Column('requested_toman_amount', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('pending', 'approved', 'rejected', name='topupstatus', native_enum=False), nullable=False),
    sa.Column('final_toman_amount', sa.Integer(), nullable=True),
    sa.Column('transaction_reference', sa.String(length=100), nullable=True),
    sa.Column('rejection_reason', sa.String(length=500), nullable=True),
    sa.Column('reviewed_by_user_id', sa.Integer(), nullable=True),
    sa.Column('reviewed_at', app.core.time.UTCDateTime(), nullable=True),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.CheckConstraint("(status = 'pending' AND final_toman_amount IS NULL AND transaction_reference IS NULL  AND rejection_reason IS NULL AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL) OR (status = 'approved' AND final_toman_amount IS NOT NULL AND transaction_reference IS NOT NULL  AND rejection_reason IS NULL AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL) OR (status = 'rejected' AND final_toman_amount IS NULL AND transaction_reference IS NULL  AND rejection_reason IS NOT NULL AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL)", name='ck_topup_review_fields_match_status'),
    sa.ForeignKeyConstraint(['reviewed_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('audience_group_members',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('group_id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('added_at', app.core.time.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['group_id'], ['audience_groups.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('group_id', 'user_id', name='uq_group_member')
    )
    op.create_table('contents',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('content_type', sa.Enum('photo', 'short_video', name='contenttype', native_enum=False), nullable=False),
    sa.Column('duration_seconds', sa.Integer(), nullable=True),
    sa.Column('original_file_path', sa.String(length=500), nullable=False),
    sa.Column('is_paid', sa.Boolean(), nullable=False),
    sa.Column('price_drops', sa.Integer(), nullable=True),
    sa.Column('has_spoiler', sa.Boolean(), nullable=False),
    sa.Column('audience_type', sa.Enum('public', 'followers', 'user', 'group', name='contentaudience', native_enum=False), nullable=False),
    sa.Column('audience_user_id', sa.Integer(), nullable=True),
    sa.Column('audience_group_id', sa.Integer(), nullable=True),
    sa.Column('is_pinned', sa.Boolean(), nullable=False),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.CheckConstraint("(audience_type IN ('public', 'followers')  AND audience_user_id IS NULL AND audience_group_id IS NULL)OR (audience_type = 'user'  AND audience_user_id IS NOT NULL AND audience_group_id IS NULL)OR (audience_type = 'group'  AND audience_group_id IS NOT NULL AND audience_user_id IS NULL)", name='ck_audience_target_matches_type'),
    sa.CheckConstraint("(content_type = 'short_video' AND duration_seconds IS NOT NULL  AND duration_seconds > 0 AND duration_seconds <= 60) OR (content_type = 'photo' AND duration_seconds IS NULL)", name='ck_duration_matches_content_type'),
    sa.CheckConstraint('(is_paid AND price_drops IS NOT NULL) OR (NOT is_paid AND price_drops IS NULL)', name='ck_price_matches_is_paid'),
    sa.CheckConstraint('NOT is_paid OR has_spoiler', name='ck_paid_implies_spoiler'),
    sa.ForeignKeyConstraint(['audience_group_id'], ['audience_groups.id'], ),
    sa.ForeignKeyConstraint(['audience_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('requests',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('buyer_id', sa.Integer(), nullable=False),
    sa.Column('offer_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('pending', 'accepted', 'rejected', 'cancelled', name='requeststatus', native_enum=False), nullable=False),
    sa.Column('reason', sa.String(length=500), nullable=True),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.Column('responded_at', app.core.time.UTCDateTime(), nullable=True),
    sa.CheckConstraint("(status IN ('rejected', 'cancelled') AND reason IS NOT NULL) OR (status IN ('pending', 'accepted') AND reason IS NULL)", name='ck_reason_matches_status'),
    sa.ForeignKeyConstraint(['buyer_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['offer_id'], ['offers.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('withdrawals',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('bank_account_id', sa.Integer(), nullable=False),
    sa.Column('idempotency_key', sa.String(length=64), nullable=False),
    sa.Column('holder_name', sa.String(length=128), nullable=False),
    sa.Column('card_number', sa.String(length=16), nullable=False),
    sa.Column('iban', sa.String(length=26), nullable=False),
    sa.Column('drops', sa.Integer(), nullable=False),
    sa.Column('drop_rate', sa.Integer(), nullable=False),
    sa.Column('fee_percent', sa.Integer(), nullable=False),
    sa.Column('minimum_toman', sa.Integer(), nullable=False),
    sa.Column('gross_toman', sa.Integer(), nullable=False),
    sa.Column('fee_toman', sa.Integer(), nullable=False),
    sa.Column('net_toman', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('assigned_to_user_id', sa.Integer(), nullable=True),
    sa.Column('reference', sa.String(length=128), nullable=True),
    sa.Column('reason', sa.String(length=500), nullable=True),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.Column('updated_at', app.core.time.UTCDateTime(), nullable=False),
    sa.CheckConstraint("status != 'paid' OR (reference IS NOT NULL AND length(trim(reference)) > 0)", name='ck_withdrawal_paid_reference'),
    sa.CheckConstraint("status IN ('pending','processing','bank_pending','paid','rejected','failed','cancelled')", name='ck_withdrawal_status'),
    sa.CheckConstraint('drops > 0 AND drop_rate > 0 AND gross_toman = drops * drop_rate AND fee_toman >= 0 AND net_toman > 0 AND fee_toman + net_toman = gross_toman', name='ck_withdrawal_amounts'),
    sa.ForeignKeyConstraint(['assigned_to_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['bank_account_id'], ['bank_accounts.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'idempotency_key', name='uq_withdrawal_retry')
    )
    with op.batch_alter_table('withdrawals', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_withdrawals_status'), ['status'], unique=False)
        batch_op.create_index(batch_op.f('ix_withdrawals_user_id'), ['user_id'], unique=False)

    op.create_table('content_open_logs',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('opened_at', app.core.time.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['content_id'], ['contents.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('content_purchases',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('purchased_at', app.core.time.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['content_id'], ['contents.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'content_id', name='uq_content_purchase')
    )
    op.create_table('likes',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('content_id', sa.Integer(), nullable=False),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['content_id'], ['contents.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('user_id', 'content_id', name='uq_like')
    )
    op.create_table('transactions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('kind', sa.Enum('chat_request', 'content_purchase', name='transactionkind', native_enum=False), nullable=False),
    sa.Column('buyer_id', sa.Integer(), nullable=False),
    sa.Column('provider_id', sa.Integer(), nullable=False),
    sa.Column('request_id', sa.Integer(), nullable=True),
    sa.Column('content_id', sa.Integer(), nullable=True),
    sa.Column('gross_price_drops', sa.Integer(), nullable=False),
    sa.Column('commission_rate_percent', sa.Integer(), nullable=False),
    sa.Column('commission_drops', sa.Integer(), nullable=False),
    sa.Column('net_provider_drops', sa.Integer(), nullable=False),
    sa.Column('drop_to_toman_rate', sa.Integer(), nullable=False),
    sa.Column('gross_price_toman', sa.Integer(), nullable=False),
    sa.Column('commission_toman', sa.Integer(), nullable=False),
    sa.Column('net_provider_toman', sa.Integer(), nullable=False),
    sa.Column('status', sa.Enum('pending', 'succeeded', 'failed', 'refunded', name='transactionstatus', native_enum=False), nullable=False),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.Column('disputed_at', app.core.time.UTCDateTime(), nullable=True),
    sa.CheckConstraint("(kind = 'chat_request' AND request_id IS NOT NULL AND content_id IS NULL) OR (kind = 'content_purchase' AND content_id IS NOT NULL AND request_id IS NULL)", name='ck_transaction_target_matches_kind'),
    sa.CheckConstraint('commission_drops + net_provider_drops = gross_price_drops', name='ck_drop_split_sums_to_gross'),
    sa.ForeignKeyConstraint(['buyer_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['content_id'], ['contents.id'], ),
    sa.ForeignKeyConstraint(['provider_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['request_id'], ['requests.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_table('withdrawal_events',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('withdrawal_id', sa.Integer(), nullable=False),
    sa.Column('actor_id', sa.Integer(), nullable=False),
    sa.Column('status', sa.String(length=24), nullable=False),
    sa.Column('reference', sa.String(length=128), nullable=True),
    sa.Column('reason', sa.String(length=500), nullable=True),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.ForeignKeyConstraint(['actor_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['withdrawal_id'], ['withdrawals.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('withdrawal_events', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_withdrawal_events_withdrawal_id'), ['withdrawal_id'], unique=False)

    op.create_table('chat_sessions',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('request_id', sa.Integer(), nullable=False),
    sa.Column('transaction_id', sa.Integer(), nullable=True),
    sa.Column('reserved_blocks', sa.Integer(), nullable=False),
    sa.Column('block_duration_seconds', sa.Integer(), nullable=False),
    sa.Column('block_price_drops', sa.Integer(), nullable=False),
    sa.Column('block_price_toman', sa.Integer(), nullable=False),
    sa.Column('reserved_toman', sa.Integer(), nullable=False),
    sa.Column('released_toman', sa.Integer(), nullable=False),
    sa.Column('consumed_toman', sa.Integer(), nullable=False),
    sa.Column('consumed_blocks', sa.Integer(), nullable=False),
    sa.Column('started_at', app.core.time.UTCDateTime(), nullable=True),
    sa.Column('scheduled_end_at', app.core.time.UTCDateTime(), nullable=True),
    sa.Column('close_at_block_end_by_user_id', sa.Integer(), nullable=True),
    sa.Column('close_at_block_end_at', app.core.time.UTCDateTime(), nullable=True),
    sa.Column('end_reason', sa.String(length=32), nullable=True),
    sa.Column('extension_requested_at', app.core.time.UTCDateTime(), nullable=True),
    sa.Column('settlement_confirmed_by_buyer_at', app.core.time.UTCDateTime(), nullable=True),
    sa.Column('settlement_confirmed_by_provider_at', app.core.time.UTCDateTime(), nullable=True),
    sa.Column('status', sa.Enum('open', 'closed', name='chatsessionstatus', native_enum=False), nullable=False),
    sa.Column('opened_at', app.core.time.UTCDateTime(), nullable=False),
    sa.Column('closed_at', app.core.time.UTCDateTime(), nullable=True),
    sa.Column('closed_by_user_id', sa.Integer(), nullable=True),
    sa.Column('archived_by_buyer', sa.Boolean(), nullable=False),
    sa.Column('archived_by_provider', sa.Boolean(), nullable=False),
    sa.ForeignKeyConstraint(['close_at_block_end_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['closed_by_user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['request_id'], ['requests.id'], ),
    sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('request_id'),
    sa.UniqueConstraint('transaction_id')
    )
    op.create_table('chat_messages',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('chat_session_id', sa.Integer(), nullable=False),
    sa.Column('sender_id', sa.Integer(), nullable=False),
    sa.Column('type', sa.Enum('text', 'photo', 'video', 'voice', name='chatmessagetype', native_enum=False), nullable=False),
    sa.Column('text', sa.String(length=4000), nullable=True),
    sa.Column('file_path', sa.String(length=500), nullable=True),
    sa.Column('duration_seconds', sa.Integer(), nullable=True),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.CheckConstraint("(type = 'text' AND text IS NOT NULL AND file_path IS NULL AND duration_seconds IS NULL) OR (type = 'photo' AND file_path IS NOT NULL AND text IS NULL AND duration_seconds IS NULL) OR (type = 'video' AND file_path IS NOT NULL AND duration_seconds IS NOT NULL AND text IS NULL) OR (type = 'voice' AND duration_seconds IS NOT NULL AND text IS NULL)", name='ck_chat_message_fields_match_type'),
    sa.ForeignKeyConstraint(['chat_session_id'], ['chat_sessions.id'], ),
    sa.ForeignKeyConstraint(['sender_id'], ['users.id'], ),
    sa.PrimaryKeyConstraint('id')
    )
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.create_index(batch_op.f('ix_chat_messages_chat_session_id'), ['chat_session_id'], unique=False)
        batch_op.create_index(batch_op.f('ix_chat_messages_created_at'), ['created_at'], unique=False)

    op.create_table('credit_ledger_entries',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=True),
    sa.Column('amount_toman', sa.Integer(), nullable=False),
    sa.Column('type', sa.Enum('topup', 'topup_dev_stub', 'spend', 'receive', 'commission', 'withdrawal', 'withdrawal_refund', 'session_hold', 'session_hold_release', name='ledgerentrytype', native_enum=False), nullable=False),
    sa.Column('transaction_id', sa.Integer(), nullable=True),
    sa.Column('withdrawal_id', sa.Integer(), nullable=True),
    sa.Column('chat_session_id', sa.Integer(), nullable=True),
    sa.Column('created_at', app.core.time.UTCDateTime(), nullable=False),
    sa.CheckConstraint("(type = 'commission' AND user_id IS NULL) OR (type != 'commission' AND user_id IS NOT NULL)", name='ck_commission_entries_have_no_user'),
    sa.CheckConstraint("(type IN ('topup_dev_stub', 'topup') AND transaction_id IS NULL AND withdrawal_id IS NULL) OR (type IN ('withdrawal', 'withdrawal_refund') AND transaction_id IS NULL AND withdrawal_id IS NOT NULL) OR (type = 'commission' AND ((transaction_id IS NOT NULL AND withdrawal_id IS NULL) OR (transaction_id IS NULL AND withdrawal_id IS NOT NULL))) OR (type IN ('spend', 'receive') AND transaction_id IS NOT NULL AND withdrawal_id IS NULL) OR (type IN ('session_hold', 'session_hold_release') AND chat_session_id IS NOT NULL)", name='ck_ledger_source'),
    sa.ForeignKeyConstraint(['chat_session_id'], ['chat_sessions.id'], ),
    sa.ForeignKeyConstraint(['transaction_id'], ['transactions.id'], ),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ),
    sa.ForeignKeyConstraint(['withdrawal_id'], ['withdrawals.id'], ),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('withdrawal_id', 'type', name='uq_withdrawal_ledger_type')
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('credit_ledger_entries')
    with op.batch_alter_table('chat_messages', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_chat_messages_created_at'))
        batch_op.drop_index(batch_op.f('ix_chat_messages_chat_session_id'))

    op.drop_table('chat_messages')
    op.drop_table('chat_sessions')
    with op.batch_alter_table('withdrawal_events', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_withdrawal_events_withdrawal_id'))

    op.drop_table('withdrawal_events')
    op.drop_table('transactions')
    op.drop_table('likes')
    op.drop_table('content_purchases')
    op.drop_table('content_open_logs')
    with op.batch_alter_table('withdrawals', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_withdrawals_user_id'))
        batch_op.drop_index(batch_op.f('ix_withdrawals_status'))

    op.drop_table('withdrawals')
    op.drop_table('requests')
    op.drop_table('contents')
    op.drop_table('audience_group_members')
    op.drop_table('topup_requests')
    op.drop_table('profiles')
    op.drop_table('profile_photos')
    op.drop_table('offers')
    op.drop_table('follows')
    with op.batch_alter_table('bank_accounts', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_bank_accounts_user_id'))

    op.drop_table('bank_accounts')
    op.drop_table('audience_groups')
    op.drop_table('admin_grants')
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index(batch_op.f('ix_users_telegram_id'))

    op.drop_table('users')
    op.drop_table('roles')
    op.drop_table('platform_rates')
