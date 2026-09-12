import re
from datetime import datetime
from pydantic import BaseModel, Field, field_validator

class BankInput(BaseModel):
    holder_name: str = Field(min_length=2, max_length=128)
    card_number: str
    iban: str

    @field_validator('holder_name')
    @classmethod
    def name(cls, value):
        value = value.strip()
        if len(value) < 2:
            raise ValueError('holder_name_required')
        return value

    @field_validator('card_number', 'iban')
    @classmethod
    def destination(cls, value, info):
        value = value.translate(str.maketrans('۰۱۲۳۴۵۶۷۸۹٠١٢٣٤٥٦٧٨٩', '01234567890123456789'))
        value = re.sub(r'[\s-]', '', value).upper()
        pattern = r'[0-9]{16}' if info.field_name == 'card_number' else r'IR[0-9]{24}'
        if not re.fullmatch(pattern, value):
            raise ValueError('invalid_bank_format')
        return value

class BankOut(BankInput):
    id: int
    model_config = {'from_attributes': True}

class QuoteInput(BaseModel):
    stars: int = Field(gt=0, le=1_000_000_000, strict=True)

class WithdrawalInput(QuoteInput):
    bank_account_id: int = Field(gt=0, strict=True)
    quote_token: str = Field(min_length=64, max_length=64)
    idempotency_key: str = Field(min_length=16, max_length=64)

class ReviewInput(BaseModel):
    action: str
    reference: str | None = Field(default=None, max_length=128)
    reason: str | None = Field(default=None, max_length=500)

class WithdrawalOut(BaseModel):
    id: int
    user_id: int
    holder_name: str
    card_number: str
    iban: str
    stars: int
    star_rate: int
    fee_percent: int
    minimum_toman: int
    gross_toman: int
    fee_toman: int
    net_toman: int
    status: str
    assigned_to_user_id: int | None
    reference: str | None
    reason: str | None
    created_at: datetime
    updated_at: datetime
    model_config = {'from_attributes': True}
