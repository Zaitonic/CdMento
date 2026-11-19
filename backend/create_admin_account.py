"""Run once with: python -m backend.create_admin_account [--email EMAIL] [--password PASSWORD]"""

import argparse
import json
import secrets
import time
from .config import settings
from .repository import Repository
from .password_auth import PasswordAuth, AUTH_OWNER


def create_or_reset_admin(
    email: str = "admin@cdmento.com",
    password: str = "AdminCdMento2026!",
    name: str = "CdMento Administrator",
):
    repo = Repository(settings.data_dir)
    email = email.strip().casefold()
    account_id = PasswordAuth.email_id(email)
    salt = secrets.token_hex(16)
    pw_hash = PasswordAuth.password_hash(password, salt)

    account = {
        "id": account_id,
        "uid": "email_" + account_id,
        "email": email,
        "display_name": name,
        "email_verified": True,
        "salt": salt,
        "password_hash": pw_hash,
        "alg": "bcrypt",
        "role": "admin",
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    repo.put(AUTH_OWNER, "accounts", account)

    # Initialize / update profile
    repo.put(
        account["uid"],
        "profile",
        {
            "id": "account",
            "email": email,
            "display_name": name,
            "role": "admin",
            "is_admin": True,
            "bio": "System Administrator",
            "study_goal": "Oversee system operations, access monitoring & student support",
            "avatar": "rocket",
            "color": "purple",
            "created_at": time.time(),
            "updated_at": time.time(),
        },
    )

    return {
        "email": email,
        "password": password,
        "display_name": name,
        "role": "admin",
        "status": "active",
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Generate or reset an admin account")
    parser.add_argument("--email", default="admin@cdmento.com", help="Admin email")
    parser.add_argument(
        "--password", default="AdminCdMento2026!", help="Admin password"
    )
    parser.add_argument(
        "--name", default="CdMento Administrator", help="Admin display name"
    )
    args = parser.parse_args()

    result = create_or_reset_admin(args.email, args.password, args.name)
    print(json.dumps(result, indent=2))
