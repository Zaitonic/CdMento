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

    def login(self, credential, remember, client):
        now = time.time()
        with self.lock:
            attempts = self.attempts[client]
            while attempts and now - attempts[0] > 60:
                attempts.popleft()
            if len(attempts) >= 20:
                raise HTTPException(429, "Too many sign-in attempts. Please retry shortly.")
            attempts.append(now)

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

        uid = "google_" + hashlib.sha256(subject.encode()).hexdigest()
        account = {
            "id": uid,
            "email": email,
            "display_name": claims.get("name", "").strip()[:80] or email.split("@")[0],
            "email_verified": True,
            "updated_at": now,
        }
        previous = self.repo.get(AUTH_OWNER, "accounts", uid) or {}
        self.repo.put(
            AUTH_OWNER,
            "accounts",
            {**previous, **account, "created_at": previous.get("created_at", now)},
        )

        token = "google_" + secrets.token_urlsafe(32)
        expires_at = now + (30 * 24 * 60 * 60 if remember else 12 * 60 * 60)
        self.repo.put(
            AUTH_OWNER,
            "sessions",
            {
                "id": hashlib.sha256(token.encode()).hexdigest(),
                "uid": uid,
                "email": email,
                "name": account["display_name"],
                "expires_at": expires_at,
            },
        )
        return {"token": token, "profile": self.profile(uid)}

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
