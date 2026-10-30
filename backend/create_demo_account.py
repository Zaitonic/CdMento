"""Run once with: python -m backend.create_demo_account"""

import json
import secrets
from .config import settings
from .repository import Repository
from .demo_auth import DemoAuth

if __name__ == "__main__":
    if settings.auth_mode != "local" or settings.data_backend != "sqlite":
        raise SystemExit("Demo accounts are only available in local SQLite mode.")
    email = "demo@cdmento.local"
    password = "CdMento-" + secrets.token_urlsafe(12) + "!"
    DemoAuth(Repository(settings.data_dir)).create_account(email, password)
    print(json.dumps({"email": email, "password": password, "mode": "local-demo"}))
