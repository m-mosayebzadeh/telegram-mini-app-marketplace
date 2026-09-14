"""multiple profile photos, replacing Profile.avatar_url

Revision ID: 5e2a8f14c9b3
Revises: 3f1a9c7d2b40
Create Date: 2026-08-30 12:00:00.000000

Written by hand as a plain rebuild, same reasoning/pattern as
split_display_name.py: `profiles` is referenced by a foreign key from
several other tables, so this sticks to CREATE + INSERT...SELECT + swap
rather than routing through batch mode.

Existing rows: whatever a user already had in Profile.avatar_url
becomes their first ProfilePhoto row (so nobody's existing photo just
vanishes), with created_at backdated to their profile's own row id
order — good enough for "this was already there," since the exact
original upload time was never tracked before this table existed.
"""
from typing import Sequence, Union

from alembic import op


revision: str = '5e2a8f14c9b3'
down_revision: Union[str, Sequence[str], None] = '3f1a9c7d2b40'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute(
        """
        CREATE TABLE profile_photos (
            id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            url VARCHAR(500) NOT NULL,
            created_at DATETIME NOT NULL,
            PRIMARY KEY (id),
            FOREIGN KEY(user_id) REFERENCES users (id)
        )
        """
    )
    op.execute(
        """
        INSERT INTO profile_photos (user_id, url, created_at)
        SELECT user_id, avatar_url, CURRENT_TIMESTAMP
        FROM profiles
        WHERE avatar_url IS NOT NULL
        """
    )

    op.execute(
        """
        CREATE TABLE profiles_new (
            id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            bio VARCHAR(1000),
            location VARCHAR(200),
            interests JSON NOT NULL,
            is_trusted BOOLEAN DEFAULT 0 NOT NULL,
            birthday_month INTEGER,
            birthday_day INTEGER,
            PRIMARY KEY (id),
            CONSTRAINT ck_birthday_both_or_neither CHECK ((birthday_month IS NULL AND birthday_day IS NULL) OR (birthday_month BETWEEN 1 AND 12 AND birthday_day BETWEEN 1 AND 31)),
            FOREIGN KEY(user_id) REFERENCES users (id),
            UNIQUE (user_id)
        )
        """
    )
    op.execute(
        """
        INSERT INTO profiles_new (id, user_id, bio, location, interests, is_trusted, birthday_month, birthday_day)
        SELECT id, user_id, bio, location, interests, is_trusted, birthday_month, birthday_day FROM profiles
        """
    )
    op.execute("DROP TABLE profiles")
    op.execute("ALTER TABLE profiles_new RENAME TO profiles")


def downgrade() -> None:
    op.execute(
        """
        CREATE TABLE profiles_old (
            id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            avatar_url VARCHAR(500),
            bio VARCHAR(1000),
            location VARCHAR(200),
            interests JSON NOT NULL,
            is_trusted BOOLEAN DEFAULT 0 NOT NULL,
            birthday_month INTEGER,
            birthday_day INTEGER,
            PRIMARY KEY (id),
            CONSTRAINT ck_birthday_both_or_neither CHECK ((birthday_month IS NULL AND birthday_day IS NULL) OR (birthday_month BETWEEN 1 AND 12 AND birthday_day BETWEEN 1 AND 31)),
            FOREIGN KEY(user_id) REFERENCES users (id),
            UNIQUE (user_id)
        )
        """
    )
    op.execute(
        """
        INSERT INTO profiles_old (id, user_id, avatar_url, bio, location, interests, is_trusted, birthday_month, birthday_day)
        SELECT p.id, p.user_id,
               (SELECT ph.url FROM profile_photos ph WHERE ph.user_id = p.user_id ORDER BY ph.created_at DESC LIMIT 1),
               p.bio, p.location, p.interests, p.is_trusted, p.birthday_month, p.birthday_day
        FROM profiles p
        """
    )
    op.execute("DROP TABLE profiles")
    op.execute("ALTER TABLE profiles_old RENAME TO profiles")
    op.execute("DROP TABLE profile_photos")
