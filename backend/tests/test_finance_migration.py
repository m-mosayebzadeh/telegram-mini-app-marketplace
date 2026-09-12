"""Exercise the real migration chain on a temporary SQLite database."""
from pathlib import Path
import sqlite3
from alembic import command
from alembic.config import Config
from sqlalchemy import create_engine, inspect
from app.core.config import settings
from app.core.database import Base


def test_upgrade_preserves_old_money_and_matches_new_columns(tmp_path, monkeypatch):
    path = tmp_path / 'migration.db'
    monkeypatch.setattr(settings, 'database_url', 'sqlite:///' + str(path))
    config = Config(str(Path(__file__).resolve().parents[1] / 'alembic.ini'))
    command.upgrade(config, '0312f72d0c56')
    with sqlite3.connect(path) as db:
        db.execute("INSERT INTO platform_rates (id, star_to_toman_rate, chat_commission_percent, content_commission_percent, updated_at) VALUES (1,2500,10,5,'2026-09-12 12:00:00')")
        db.execute("INSERT INTO users (id,telegram_id,first_name,joined_at,status) VALUES (1,123,'Old user','2026-09-12 12:00:00','active')")
        db.execute("INSERT INTO offers (id,provider_id,service_type,price_stars,display_duration_minutes,title,description,status,created_at) VALUES (1,1,'chat',10,20,'Old offer','Description','active','2026-09-12 12:00:00')")
        db.execute("INSERT INTO requests (id,buyer_id,offer_id,status,created_at) VALUES (1,1,1,'accepted','2026-09-12 12:00:00')")
        db.execute("INSERT INTO transactions (id,kind,buyer_id,provider_id,request_id,gross_price_stars,commission_rate_percent,commission_stars,net_provider_stars,star_to_toman_rate,gross_price_toman,commission_toman,net_provider_toman,status,created_at) VALUES (1,'chat_request',1,1,1,10,10,1,9,2500,25000,2500,22500,'pending','2026-09-12 12:00:00')")
        db.execute("INSERT INTO credit_ledger_entries (id,user_id,amount_toman,type,created_at) VALUES (1,1,100000,'topup','2026-09-12 12:00:00')")
        old_tx = db.execute('SELECT * FROM transactions').fetchall()
        old_ledger = db.execute('SELECT id,user_id,amount_toman,type,transaction_id,created_at FROM credit_ledger_entries').fetchall()
    command.upgrade(config, 'head')
    with sqlite3.connect(path) as db:
        assert db.execute('SELECT * FROM transactions').fetchall() == old_tx
        assert db.execute('SELECT id,user_id,amount_toman,type,transaction_id,created_at FROM credit_ledger_entries').fetchall() == old_ledger
        assert db.execute('SELECT star_to_toman_rate, withdrawal_commission_percent, complaint_commission_percent, minimum_withdrawal_toman FROM platform_rates').fetchone() == (2500,10,0,500000)
        assert db.execute('PRAGMA foreign_key_check').fetchall() == []
    engine = create_engine('sqlite:///' + str(path))
    inspector = inspect(engine)
    for name, table in Base.metadata.tables.items():
        assert {c['name'] for c in inspector.get_columns(name)} == set(table.columns.keys()), name
    engine.dispose()
    command.downgrade(config, '0312f72d0c56')
    command.upgrade(config, 'head')
