"""gender on the profile, and a hideable birth year

The door into random chat needs two facts about a person — which gender
they are, and how old — and asks for them there rather than at signup,
where every extra field costs a user.

Gender is new, with three values where the third is a refusal rather than
an identity. NULL still means nobody has asked yet, which is where almost
every profile starts.

The age comes from the birthday columns that already existed. What is new
beside them is a switch to hide the year from other people: the reason
people leave a birth year blank is that they do not want their age
public, not that they mind being matched by it, so the year is collected
and hidden rather than not collected. Day and month stay visible.

Revision ID: c5a2f19b3e77
Revises: b83d6e15a4f2
"""
from alembic import op
import sqlalchemy as sa

revision = 'c5a2f19b3e77'
down_revision = 'b83d6e15a4f2'
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("profiles", sa.Column("gender", sa.String(length=16), nullable=True))
    op.create_check_constraint(
        "ck_profile_gender",
        "profiles",
        "gender IS NULL OR gender IN ('male', 'female', 'unsaid')",
    )
    op.add_column(
        "profiles",
        sa.Column(
            "hide_birth_year",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("false"),
        ),
    )


def downgrade() -> None:
    op.drop_column("profiles", "hide_birth_year")
    op.drop_constraint("ck_profile_gender", "profiles", type_="check")
    op.drop_column("profiles", "gender")
