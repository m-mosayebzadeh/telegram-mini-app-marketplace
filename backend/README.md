# بک‌اند — راهنمای اجرا

## ۱. راه‌اندازی اولیه (فقط یک‌بار)

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

اگه پیام «running scripts is disabled» گرفتی، یک‌بار این رو بزن و دوباره امتحان کن:
```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

یک فایل `.env` بساز (کپی از [.env.example](.env.example)) و مقدارهاش رو پر کن:
```
TELEGRAM_BOT_TOKEN=توکن-ربات-تلگرام
ENABLE_DEV_TOOLS=false
```
تا وقتی ربات واقعی نساختیم ([بخش ۸ سند نیازمندی‌ها](../docs/TECHNICAL_REQUIREMENTS.md))، یک مقدار دلخواه برای `TELEGRAM_BOT_TOKEN` کافیه. `.env` هیچ‌وقت نباید به گیت اضافه بشه (توی `.gitignore` هست).

---

## ۲. اجرای سرور

هر بار قبل از کار، محیط مجازی رو فعال کن (اگه از قبل فعال نیست):
```powershell
.\.venv\Scripts\Activate.ps1
```

اجرای معمولی:
```powershell
python -m uvicorn app.main:app --reload
```
`--reload` یعنی با هر تغییر کد، سرور خودش دوباره بالا میاد.

سرور روی `http://127.0.0.1:8000` بالا میاد. برای چک سریع: `http://127.0.0.1:8000/health`

**دیباگ با VSCode (به‌جای دستور بالا):** پنل Run and Debug (`Ctrl+Shift+D`) رو باز کن، گزینه‌ی **"FastAPI: uvicorn (debug)"** رو انتخاب کن، `F5` بزن. می‌تونی روی هر خط از کد breakpoint بذاری.

---

## ۳. اجرای تست‌های خودکار

```powershell
pytest
```

یا برای دیدن جزئیات هر تست:
```powershell
pytest -v
```

تست‌ها روی **پستگرس** اجرا می‌شن، همون موتوری که در تولید اجرا می‌شه — چون سخت‌ترین قاعده‌های این پروژه درباره‌ی پول و قفل‌اند، و اثباتشون روی یک موتور دیگه هیچ چیزی رو اثبات نمی‌کنه.

قبل از اجرای تست‌ها، پایگاه‌داده رو بالا بیار:

```powershell
docker compose up -d db
```

هر تست یک پایگاه‌داده‌ی موقت و مجزای خودش می‌گیره که بعدش پاک می‌شه، پس تست‌ها روی هم اثر نمی‌ذارن و هیچ‌کدوم به داده‌ی توسعه‌ی تو دست نمی‌زنن.

| فایل | چی رو تست می‌کنه |
|---|---|
| [tests/test_telegram_auth.py](tests/test_telegram_auth.py) | فقط تابع `validate_init_data` (امضای معتبر/دستکاری‌شده/منقضی/فیلد گم‌شده) — بدون سرور، بدون پایگاه‌داده |
| [tests/test_me_endpoint.py](tests/test_me_endpoint.py) | کل زنجیره‌ی HTTP روی مسیر `/me` — درخواست واقعی، پایگاه‌داده‌ی تستی، ساخت/بازیابی کاربر |

---

## ۴. تست دستی با Bruno

کالکشن آماده‌ست: پوشه‌ی [`bruno/`](../bruno) در ریشه‌ی پروژه.

۱. [Bruno](https://www.usebruno.com/downloads) رو نصب کن.
۲. **Open Collection** → پوشه‌ی `bruno` رو انتخاب کن.
۳. بالا-راست، محیط رو روی **local** بذار.
۴. سرور رو بالا بیار (قسمت ۲) و مطمئن شو `.env` روی `ENABLE_DEV_TOOLS=true` است.
۵. توی پوشه‌ی `Auth`، اول **Generate Test InitData** رو بزن (خودش initData معتبر می‌سازه و توی محیط ذخیره می‌کنه)، بعد **Get Me** رو بزن.

⚠️ `ENABLE_DEV_TOOLS=true` رو هیچ‌وقت وقتی تانل (کلادفلر/انگروک) به این سرور وصله روشن نذار — دلیلش توی کامنت [app/core/config.py](app/core/config.py) توضیح داده شده.

---

## ۴.۵. وقتی شِما با مدل‌ها نمی‌خونه

مهاجرت‌ها (Alembic) صاحب شِما هستن و موقع بالا اومدن سرور خودکار اجرا می‌شن. اگه مدلی رو عوض کردی، یک مهاجرت هم براش بساز:

```powershell
alembic revision --autogenerate -m "توضیح کوتاه تغییر"
alembic upgrade head
```

اگه فقط می‌خوای داده‌ی توسعه رو پاک کنی و شِما دست‌نخورده بمونه:

```powershell
python scripts/truncate_all.py
```

و اگه می‌خوای کاملاً از صفر شروع کنی:

```powershell
docker compose down -v db
docker compose up -d db
```

---

## ۵. دیدن پایگاه‌داده

پستگرس، روی پورت ۵۴۳۳ (عمداً نه ۵۴۳۲، تا با هر پستگرسی که از قبل روی سیستم نصبه قاطی نشه):

```
میزبان: localhost    پورت: 5433
کاربر: marketplace   رمز: devpass    پایگاه‌داده: marketplace
```

- توی VSCode: اکستنشن **PostgreSQL** یا **Database Client**.
- یا برنامه‌ی جدا: [pgAdmin](https://www.pgadmin.org) یا [DBeaver](https://dbeaver.io).
- یا مستقیم از خط فرمان: `docker compose exec db psql -U marketplace`

---

## ساختار پوشه‌ها

```
backend/
  app/
    core/       تنظیمات (.env) و اتصال پایگاه‌داده
    auth/       اعتبارسنجی initData تلگرام + وابستگی‌های FastAPI
    models/     مدل‌های ORM (جدول‌های پایگاه‌داده)
    dev/        مسیرهای مخصوص توسعه (فقط با ENABLE_DEV_TOOLS=true فعالن)
    main.py     نقطه‌ی ورود برنامه
  tests/        تست‌های خودکار (pytest)
```
