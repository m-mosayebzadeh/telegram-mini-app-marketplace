"""
Shared pytest setup, loaded automatically before any test file in this
folder.

app.core.config creates its `settings` singleton (which requires
TELEGRAM_BOT_TOKEN) the moment it's imported. If a test file imports
anything from `app` and no .env file exists yet (e.g. a fresh clone, or
CI) that import would crash before a single test runs. Setting a fixed
value here — before any test module gets to `import app...` — means the
test suite never depends on a developer's local .env file.

pytest guarantees conftest.py in a directory is loaded before the test
modules inside it, so this always runs first.
"""

import os

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "test-bot-token-for-pytest-only")
os.environ.setdefault("ENABLE_DEV_TOOLS", "false")
