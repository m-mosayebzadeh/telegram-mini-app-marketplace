"""
Importing this package registers every ORM model with Base.metadata —
that's what lets Base.metadata.create_all() (see app/main.py) know about
all of them, without app/main.py needing to import each model file by
hand and remember to update the list every time a new one is added.

Each model class is still imported directly wherever it's actually used
(e.g. `from app.models.user import User`); this file's only job is to
guarantee every model module gets imported at least once.
"""

from app.models.audience_group import AudienceGroup, AudienceGroupMember  # noqa: F401
from app.models.chat_session import ChatSession  # noqa: F401
from app.models.credit_ledger import CreditLedgerEntry  # noqa: F401
from app.models.follow import Follow  # noqa: F401
from app.models.offer import Offer  # noqa: F401
from app.models.photo import Photo  # noqa: F401
from app.models.photo_access import PhotoOpenLog, PhotoPurchase  # noqa: F401
from app.models.profile import Profile  # noqa: F401
from app.models.request import Request  # noqa: F401
from app.models.transaction import Transaction  # noqa: F401
from app.models.user import User  # noqa: F401
