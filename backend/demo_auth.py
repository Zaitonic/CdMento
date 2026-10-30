"""Local-only demo credentials and revocable, owner-scoped sessions."""

import hashlib
import hmac
import secrets
import threading
import time
from collections import defaultdict, deque
from fastapi import HTTPException

AUTH_OWNER = "__local_demo_auth__"
DEMO_UID = "demo-student"


class DemoAuth:
    def __init__(self, repo):
        self.repo = repo
        self.attempts = defaultdict(deque)
        self.lock = threading.RLock()

    def available(self):
        return self.repo.get(AUTH_OWNER, "accounts", DEMO_UID) is not None

    @staticmethod
    def password_hash(password, salt):
        return hashlib.scrypt(
            password.encode(), salt=bytes.fromhex(salt), n=16384, r=8, p=1, dklen=32
        ).hex()

    def create_account(self, email, password, name="Demo Student"):
        if self.available():
            raise RuntimeError(
                "A local demo account already exists; it has not been changed."
            )
        if len(password) < 12:
            raise ValueError("Use at least 12 characters for the demo password.")
        salt = secrets.token_hex(16)
        return self.repo.put(
            AUTH_OWNER,
            "accounts",
            {
                "id": DEMO_UID,
                "email": email.strip().casefold(),
                "name": name,
                "salt": salt,
                "password_hash": self.password_hash(password, salt),
            },
        )

    def profile(self):
        account = self.repo.get(AUTH_OWNER, "accounts", DEMO_UID)
        if not account:
            raise HTTPException(401, "The local demo account is unavailable.")
        return {
            "uid": DEMO_UID,
            "email": account["email"],
            "displayName": account["name"],
            "emailVerified": True,
            "kind": "local-demo",
        }

    def login(self, email, password, client):
        now = time.time()
        with self.lock:
            attempts = self.attempts[client]
            while attempts and now - attempts[0] > 600:
                attempts.popleft()
            if len(attempts) >= 10:
                raise HTTPException(
                    429, "Too many sign-in attempts. Please wait ten minutes."
                )
            attempts.append(now)
            account = self.repo.get(AUTH_OWNER, "accounts", DEMO_UID)
            salt = account["salt"] if account else "00" * 16
            candidate = self.password_hash(password, salt)
            if not account or not (
                hmac.compare_digest(
                    email.strip().casefold().encode(), account["email"].encode()
                )
                and hmac.compare_digest(candidate, account["password_hash"])
            ):
                raise HTTPException(
                    401, "The email or password is incorrect. Please try again."
                )
            attempts.clear()
            for session in self.repo.list(AUTH_OWNER, "sessions"):
                if session["expires_at"] <= now:
                    self.repo.delete(AUTH_OWNER, "sessions", session["id"])
            token = "demo_" + secrets.token_urlsafe(32)
            self.repo.put(
                AUTH_OWNER,
                "sessions",
                {
                    "id": hashlib.sha256(token.encode()).hexdigest(),
                    "uid": DEMO_UID,
                    "expires_at": now + 12 * 3600,
                },
            )
            return {"token": token, "profile": self.profile()}

    def resolve(self, token):
        session = self.repo.get(
            AUTH_OWNER, "sessions", hashlib.sha256(token.encode()).hexdigest()
        )
        if not session or session["expires_at"] <= time.time():
            raise HTTPException(401, "Your demo session expired. Please sign in again.")
        return session["uid"]

    def logout(self, token):
        self.repo.delete(
            AUTH_OWNER, "sessions", hashlib.sha256(token.encode()).hexdigest()
        )
