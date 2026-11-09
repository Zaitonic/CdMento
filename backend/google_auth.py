"""Google ID-token verification and revocable CdMento browser sessions."""

import hashlib
import secrets
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException


AUTH_OWNER = "__google_auth__"


class GoogleAuth:
    def __init__(self, repo, client_id):
        self.repo = repo
        self.client_id = client_id
        self.attempts = defaultdict(deque)
        self.lock = threading.RLock()

    def _throttle(self, client):
        now = time.time()
        with self.lock:
            attempts = self.attempts[client]
            while attempts and now - attempts[0] > 60:
                attempts.popleft()
            if len(attempts) >= 20:
                raise HTTPException(429, "Too many sign-in attempts. Please retry shortly.")
            attempts.append(now)

    def _verify(self, credential, client):
        self._throttle(client)
        try:
            from google.auth.transport.requests import Request
            from google.oauth2 import id_token

            claims = id_token.verify_oauth2_token(
                credential, Request(), audience=self.client_id
            )
        except Exception:
            raise HTTPException(401, "Google sign-in could not be verified. Please try again.") from None

        subject = claims.get("sub")
        email = claims.get("email", "").strip().casefold()
        if not subject or not email or claims.get("email_verified") is not True:
            raise HTTPException(401, "Use a Google account with a verified email address.")
        return subject, email, claims.get("name", "").strip()[:80]

    @staticmethod
    def email_id(email):
        return hashlib.sha256(email.strip().casefold().encode()).hexdigest()

    def _password_account_exists(self, email):
        return self.repo.get(
            "__email_password_auth__", "accounts", self.email_id(email)
        ) is not None

    def _session(self, account, remember):
        now = time.time()
        token = "google_" + secrets.token_urlsafe(32)
        expires_at = now + (30 * 24 * 60 * 60 if remember else 12 * 60 * 60)
        self.repo.put(
            AUTH_OWNER,
            "sessions",
            {
                "id": hashlib.sha256(token.encode()).hexdigest(),
                "uid": account["id"],
                "email": account["email"],
                "name": account["display_name"],
                "expires_at": expires_at,
            },
        )
        return {"token": token, "profile": self.profile(account["id"])}

    def prepare(self, credential, remember, client):
        subject, email, name = self._verify(credential, client)
        uid = "google_" + hashlib.sha256(subject.encode()).hexdigest()
        account = self.repo.get(AUTH_OWNER, "accounts", uid)
        if account:
            return {"requires_signup": False, **self._session(account, remember)}
        if self._password_account_exists(email):
            raise HTTPException(
                409,
                "An account already uses this email. Sign in with email and password.",
            )
        return {
            "requires_signup": True,
            "email": email,
            "display_name": name or email.split("@")[0],
        }

    def register(self, credential, remember, client):
        subject, email, name = self._verify(credential, client)
        uid = "google_" + hashlib.sha256(subject.encode()).hexdigest()
        account = self.repo.get(AUTH_OWNER, "accounts", uid)
        if account:
            return {"requires_signup": False, **self._session(account, remember)}
        if self._password_account_exists(email):
            raise HTTPException(
                409,
                "An account already uses this email. Sign in with email and password.",
            )

        now = time.time()
        account = {
            "id": uid,
            "email": email,
            "display_name": name or email.split("@")[0],
            "email_verified": True,
            "updated_at": now,
            "created_at": now,
        }
        self.repo.put(AUTH_OWNER, "accounts", account)
        return {"requires_signup": False, **self._session(account, remember)}

    def login(self, credential, remember, client):
        subject, email, name = self._verify(credential, client)
        uid = "google_" + hashlib.sha256(subject.encode()).hexdigest()
        account = self.repo.get(AUTH_OWNER, "accounts", uid)
        if not account:
            if self._password_account_exists(email):
                raise HTTPException(
                    409,
                    "An account already uses this email. Sign in with email and password.",
                )
            raise HTTPException(404, "No CdMento account uses this Google account yet.")

        account = self.repo.put(
            AUTH_OWNER,
            "accounts",
            {
                **account,
                "email": email,
                "display_name": name or account["display_name"],
                "updated_at": time.time(),
            },
        )
        return self._session(account, remember)

    def resolve(self, token):
        session_id = hashlib.sha256(token.encode()).hexdigest()
        session = self.repo.get(AUTH_OWNER, "sessions", session_id)
        if not session or session["expires_at"] <= time.time():
            raise HTTPException(401, "Your Google session expired. Please sign in again.")
        return {
            "uid": session["uid"],
            "email": session["email"],
            "name": session["name"],
            "email_verified": True,
        }

    def profile(self, uid):
        account = self.repo.get(AUTH_OWNER, "accounts", uid)
        if not account:
            raise HTTPException(401, "Your Google account could not be loaded. Please sign in again.")
        return {
            "uid": uid,
            "email": account["email"],
            "displayName": account["display_name"],
            "emailVerified": True,
            "kind": "google",
        }

    def logout(self, token):
        self.repo.delete(
            AUTH_OWNER, "sessions", hashlib.sha256(token.encode()).hexdigest()
        )
