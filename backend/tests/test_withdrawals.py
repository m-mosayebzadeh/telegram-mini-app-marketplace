"""Withdrawal invariants through HTTP, plus real multi-connection SQLite races."""
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import uuid4
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session
from app.main import app
from app.core.config import settings
from app.core.database import Base, get_db
from app.core.rates import get_rates
from app.models.withdrawal import Withdrawal, WithdrawalEvent
from app.models.credit_ledger import CreditLedgerEntry, LedgerEntryType
from app.models.transaction import Transaction
from tests.helpers import give_wallet_balance, sign_init_data
from tests.test_content_endpoints import _upload
from tests.test_request_payment import _create_offer, _create_accepted_request

BANK = {'holder_name':'Test Owner', 'card_number':'6037991234567890', 'iban':'IR123456789012345678901234'}
def auth(id):
    return {'X-Telegram-Init-Data':sign_init_data({'id':id,'first_name':f'User {id}'})}

@pytest.fixture(autouse=True)
def owner(monkeypatch):
    monkeypatch.setattr(settings,'owner_telegram_id',99)

def set_rates(client, **changes):
    """Change platform rates through the real admin endpoint.

    Reads the current values first so a caller only has to name what it wants
    different — the update endpoint takes the whole set.
    """
    current = client.get('/admin/rates', headers=auth(99)).json()
    current.pop('updated_at', None)  # read-only on the way back in
    response = client.put('/admin/rates', headers=auth(99), json={**current, **changes})
    assert response.status_code == 200, response.text


def give_earnings(client, db, stars):
    """Make user 1 genuinely EARN `stars`, by running a real sale.

    Withdrawals are capped at what a user earned on the platform — money they
    merely topped up can be spent here but never cashed out to a bank card —
    so a withdrawal test cannot simply credit a wallet. The chat commission is
    switched off first so these tests keep round numbers; the commission split
    itself is covered by the payment tests.
    """
    from app.wallet.service import release_transaction

    set_rates(client, chat_commission_percent=0)
    buyer = client.get('/me', headers=auth(2)).json()
    give_wallet_balance(db, buyer['id'], stars * settings.star_to_toman_rate)
    offer = _create_offer(client, auth(1), price_stars=stars)
    request = _create_accepted_request(client, auth(1), auth(2), offer)
    assert client.post(f"/requests/{request['id']}/pay", headers=auth(2)).status_code == 201
    transaction = db.query(Transaction).filter_by(request_id=request['id']).one()
    release_transaction(db, transaction)
    db.commit()


def setup(client, db, amount=1_000_000):
    user = client.get('/me',headers=auth(1)).json()
    client.get('/me',headers=auth(99))
    give_earnings(client, db, amount // settings.star_to_toman_rate)
    bank = client.post('/wallet/bank-accounts',headers=auth(1),json=BANK)
    assert bank.status_code == 201
    return user['id'], bank.json()['id']

def payload(client, bank, stars=200):
    quote = client.post('/wallet/withdrawals/quote',headers=auth(1),json={'stars':stars}).json()
    return dict(stars=stars, bank_account_id=bank, quote_token=quote['quote_token'], idempotency_key=str(uuid4()))

def create(client, body):
    return client.post('/wallet/withdrawals',headers=auth(1),json=body)

def balance(client):
    return client.get('/wallet/balance',headers=auth(1)).json()['balance_toman']

def review(client, id, action, **kwargs):
    return client.post(f'/admin/withdrawals/{id}/review',headers=auth(99),json={'action':action,**kwargs})

def test_snapshot_fee_hold_cancel_and_replay(client,db_session):
    user,bank=setup(client,db_session)
    set_rates(client, withdrawal_commission_percent=10)
    body=payload(client,bank)
    first=create(client,body)
    assert first.status_code==201, first.text
    row=first.json()
    assert (row['gross_toman'],row['fee_toman'],row['net_toman'])==(500000,50000,450000)
    assert balance(client)==500000
    again=create(client,body)
    assert again.json()['id']==row['id']
    assert balance(client)==500000
    client.put(f'/wallet/bank-accounts/{bank}',headers=auth(1),json={**BANK,'holder_name':'Changed','card_number':'6037999999999999'})
    history=client.get('/wallet/withdrawals',headers=auth(1)).json()[0]
    assert history['holder_name']==BANK['holder_name'] and history['card_number']==BANK['card_number']
    assert client.post(f"/wallet/withdrawals/{row['id']}/cancel",headers=auth(1)).status_code==200
    assert balance(client)==1000000
    assert client.post(f"/wallet/withdrawals/{row['id']}/cancel",headers=auth(1)).status_code==409
    assert balance(client)==1000000

@pytest.mark.parametrize('stars',[0,-1,1.5,'200',True,1_000_000_001])
def test_invalid_amounts(client,stars):
    assert client.post('/wallet/withdrawals/quote',headers=auth(1),json={'stars':stars}).status_code==422

@pytest.mark.parametrize('field,value',[('card_number','123'),('iban','IR123'),('holder_name','  ')])
def test_bank_format(client,field,value):
    assert client.post('/wallet/bank-accounts',headers=auth(1),json={**BANK,field:value}).status_code==422

def test_owner_checks_and_minimum(client,db_session):
    _,bank=setup(client,db_session)
    assert create(client,payload(client,bank,199)).status_code==400
    assert balance(client)==1000000
    assert client.put(f'/wallet/bank-accounts/{bank}',headers=auth(2),json=BANK).status_code==404
    q=client.post('/wallet/withdrawals/quote',headers=auth(2),json={'stars':200}).json()
    assert client.post('/wallet/withdrawals',headers=auth(2),json={**payload(client,bank),'quote_token':q['quote_token']}).status_code==404
    assert client.get('/admin/withdrawals',headers=auth(1)).status_code==403

def test_stale_quote_reconfirmation_and_historical_rates(client,db_session):
    _,bank=setup(client,db_session)
    body=payload(client,bank)
    update={'star_to_toman_rate':3000,'chat_commission_percent':10,'content_commission_percent':5,
            'withdrawal_commission_percent':11,'complaint_commission_percent':0,'minimum_withdrawal_toman':500000}
    assert client.put('/admin/rates',headers=auth(99),json=update).status_code==200
    response=create(client,body)
    assert response.status_code==409
    assert response.json()['detail']['reason']=='quote_changed'
    assert balance(client)==1000000
    body['quote_token']=response.json()['detail']['quote']['quote_token']
    row=create(client,body).json()
    assert (row['gross_toman'],row['fee_toman'],row['net_toman'])==(600000,66000,534000)
    client.put('/admin/rates',headers=auth(99),json={**update,'withdrawal_commission_percent':20})
    assert client.get('/wallet/withdrawals',headers=auth(1)).json()[0]['fee_toman']==66000

def test_processing_unknown_paid_exactly_once(client,db_session):
    _,bank=setup(client,db_session)
    set_rates(client, withdrawal_commission_percent=10)
    row=create(client,payload(client,bank)).json();id=row['id']
    assert review(client,id,'processing').status_code==200
    assert client.post(f'/wallet/withdrawals/{id}/cancel',headers=auth(1)).status_code==409
    assert review(client,id,'paid').status_code==400
    assert review(client,id,'bank_pending',reason='Waiting for bank').status_code==200
    assert balance(client)==500000
    assert review(client,id,'processing').status_code==409
    assert review(client,id,'paid',reference='BANK-100').status_code==200
    assert review(client,id,'paid',reference='BANK-100').status_code==409
    assert balance(client)==500000
    fee=db_session.query(CreditLedgerEntry).filter_by(withdrawal_id=id,type=LedgerEntryType.COMMISSION).one()
    assert fee.amount_toman==50000
    assert db_session.query(WithdrawalEvent).filter_by(withdrawal_id=id).count()==4

@pytest.mark.parametrize('action',['rejected','failed'])
def test_unsuccessful_releases_entire_amount(client,db_session,action):
    _,bank=setup(client,db_session)
    id=create(client,payload(client,bank)).json()['id']
    if action=='failed':
        review(client,id,'processing')
        review(client,id,'bank_pending',reason='Bank unavailable',reference='BANK-UNKNOWN')
    assert review(client,id,action,reason='Transfer definitely not made').status_code==200
    assert balance(client)==1000000
    assert db_session.query(CreditLedgerEntry).filter_by(withdrawal_id=id,type=LedgerEntryType.COMMISSION).count()==0

@pytest.fixture
def concurrent_client(tmp_path):
    engine=create_engine('sqlite:///'+str(tmp_path/'concurrent.db'),connect_args={'check_same_thread':False,'timeout':15})
    Base.metadata.create_all(engine)
    def sessions():
        with Session(engine,autoflush=False) as db:
            yield db
    app.dependency_overrides[get_db]=sessions
    client=TestClient(app)
    with Session(engine,autoflush=False) as db:
        yield client,db
    app.dependency_overrides.clear()
    engine.dispose()

def race(*calls):
    barrier=Barrier(len(calls))
    def run(call):
        barrier.wait()
        return call()
    with ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run,calls))

@pytest.mark.parametrize('same_key',[True,False])
def test_concurrent_withdrawals_cannot_overdraw(concurrent_client,same_key):
    client,db=concurrent_client
    _,bank=setup(client,db,500000)
    one=payload(client,bank);two=one if same_key else payload(client,bank)
    results=race(lambda:create(client,one),lambda:create(client,two))
    assert sorted(r.status_code for r in results)==([201,201] if same_key else [201,402])
    assert balance(client)==0
    assert db.query(Withdrawal).count()==1

@pytest.mark.parametrize('purchase_kind',['content','chat'])
def test_withdrawal_and_purchase_share_balance_lock(concurrent_client,purchase_kind):
    client,db=concurrent_client
    _,bank=setup(client,db,500000)
    body=payload(client,bank)
    client.get('/me',headers=auth(2))
    if purchase_kind=='content':
        item=_upload(client,auth(2),is_paid=True,price_stars=200).json()
        path=f"/content/{item['id']}/purchase"
    else:
        offer=_create_offer(client,auth(2),price_stars=200)
        request=_create_accepted_request(client,auth(2),auth(1),offer)
        path=f"/requests/{request['id']}/pay"
    results=race(lambda:create(client,body),lambda:client.post(path,headers=auth(1)))
    assert sorted(r.status_code for r in results)==[201,402], [r.text for r in results]
    assert balance(client)==0

def test_staff_claim_and_customer_cancel_are_exclusive(concurrent_client):
    client,db=concurrent_client
    _,bank=setup(client,db)
    id=create(client,payload(client,bank)).json()['id']
    results=race(lambda:review(client,id,'processing'),lambda:client.post(f'/wallet/withdrawals/{id}/cancel',headers=auth(1)))
    assert sorted(r.status_code for r in results)==[200,409]
    row=client.get('/wallet/withdrawals',headers=auth(1)).json()[0]
    assert balance(client)==(1000000 if row['status']=='cancelled' else 500000)

def test_content_purchase_takes_its_commission_immediately(client,db_session):
    """Content is delivered the moment it is paid for, so there is nothing to
    wait on: the platform's cut is taken in the same breath as the charge.
    25 stars at the default 5% is 1.25, floored to 1 in the provider's favour."""
    setup(client,db_session)
    client.get('/me',headers=auth(2))
    item=_upload(client,auth(2),is_paid=True,price_stars=25).json()
    assert client.post(f"/content/{item['id']}/purchase",headers=auth(1)).status_code==201
    tx=db_session.query(Transaction).filter_by(kind='content_purchase').one()
    assert tx.commission_rate_percent==settings.content_commission_percent
    assert tx.commission_stars==1
    assert tx.net_provider_stars==24
    assert tx.commission_toman==1*tx.star_to_toman_rate


def test_historical_pending_transaction_keeps_its_original_fee(client,db_session):
    from app.wallet.service import release_transaction
    setup(client,db_session)
    client.get('/me',headers=auth(2))
    offer=_create_offer(client,auth(2),price_stars=40)
    req=_create_accepted_request(client,auth(2),auth(1),offer)
    client.post(f"/requests/{req['id']}/pay",headers=auth(1))
    tx=db_session.query(Transaction).filter_by(request_id=req['id']).one()
    tx.commission_rate_percent=10
    tx.commission_stars=4
    tx.net_provider_stars=36
    tx.commission_toman=10000
    tx.net_provider_toman=90000
    db_session.commit()
    release_transaction(db_session,tx)
    db_session.commit()
    release_transaction(db_session,tx)
    db_session.commit()
    earnings=db_session.query(CreditLedgerEntry).filter_by(transaction_id=tx.id,type=LedgerEntryType.RECEIVE).all()
    assert len(earnings)==1 and earnings[0].amount_toman==90000
    assert tx.commission_rate_percent==10


def test_fee_is_floored_in_toman(client,db_session):
    setup(client,db_session)
    rates=get_rates(db_session)
    rates.star_to_toman_rate=2501
    rates.withdrawal_commission_percent=7
    db_session.commit()
    q=client.post('/wallet/withdrawals/quote',headers=auth(1),json={'stars':201}).json()
    assert q['gross_toman']==502701
    assert q['fee_toman']==35189
    assert q['net_toman']==467512


def test_second_staff_cannot_pay_an_assigned_request(client,db_session):
    from app.models.role import Role
    from app.models.admin_grant import AdminGrant
    _,bank=setup(client,db_session)
    staff=client.get('/me',headers=auth(3)).json()['id']
    owner=client.get('/me',headers=auth(99)).json()['id']
    role=Role(name='Withdrawals',scopes=['finance.withdrawals'],is_active=True)
    db_session.add(role);db_session.flush()
    db_session.add(AdminGrant(user_id=staff,role_id=role.id,granted_by_user_id=owner))
    db_session.commit()
    id=create(client,payload(client,bank)).json()['id']
    assert review(client,id,'processing').status_code==200
    response=client.post(f'/admin/withdrawals/{id}/review',headers=auth(3),json={'action':'paid','reference':'bank'})
    assert response.status_code==409
    assert response.json()['detail']['reason']=='assigned_to_other_staff'


def test_duplicate_success_callbacks_credit_once(concurrent_client):
    from app.models.star_purchase import StarPurchase
    client,db=concurrent_client
    user,_=setup(client,db)
    purchase=StarPurchase(user_id=user,stars=10,invoice_payload='concurrent-stars')
    db.add(purchase);db.commit()
    body={'message':{'from':{'id':1},'successful_payment':{'telegram_payment_charge_id':'same-charge',
          'invoice_payload':'concurrent-stars','currency':'XTR','total_amount':10}}}
    def callback():
        return client.post('/telegram/webhook',headers={'X-Telegram-Bot-Api-Secret-Token':settings.telegram_webhook_secret},json=body)
    assert [r.status_code for r in race(callback,callback)]==[200,200]
    assert balance(client)==1025000
    assert db.query(CreditLedgerEntry).filter_by(star_purchase_id=purchase.id).count()==1


def test_bank_accepts_localized_digits(client):
    row=client.post('/wallet/bank-accounts',headers=auth(1),json={**BANK,'card_number':'۶۰۳۷۹۹۱۲۳۴۵۶۷۸۹۰','iban':'IR۱۲۳۴۵۶۷۸۹۰۱۲۳۴۵۶۷۸۹۰۱۲۳۴'})
    assert row.status_code==201
    assert row.json()['card_number']==BANK['card_number']
    assert row.json()['iban']==BANK['iban']


def test_topped_up_money_cannot_be_withdrawn(client, db_session):
    """The whole point of the ceiling: someone who only ever topped up can
    spend inside the app but cannot route that money to a bank card."""
    user = client.get('/me', headers=auth(1)).json()
    client.get('/me', headers=auth(99))
    give_wallet_balance(db_session, user['id'], 1_000_000)
    bank = client.post('/wallet/bank-accounts', headers=auth(1), json=BANK).json()['id']

    response = create(client, payload(client, bank))

    assert response.status_code == 400
    detail = response.json()['detail']
    assert detail['reason'] == 'exceeds_withdrawable'
    # The error carries the ceiling itself, so the UI can say how much is
    # actually available instead of only "not allowed".
    assert detail['withdrawable_toman'] == 0
    assert balance(client) == 1_000_000  # nothing was held


def test_the_quote_reports_the_ceiling(client, db_session):
    _, bank = setup(client, db_session)

    quoted = client.post('/wallet/withdrawals/quote', headers=auth(1), json={'stars': 200}).json()

    assert quoted['withdrawable_toman'] == 1_000_000
